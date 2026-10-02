// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVyraLocking} from "./interfaces/IVyraLocking.sol";

/// @title VyraRewardPool
/// @notice The single treasury of the Keep. Lock payments and level-upgrade payments flow in here,
///         anyone may deposit, and holders' daily rewards are paid out of it.
/// @dev Security model:
///      - Tokens leave only three ways: reward claims (to the lock owner), settlement on
///        unlock/renew (to the lock owner), and `withdrawSurplus` by the owner.
///      - When a lock opens, its full-period reward is reserved. A lock cannot open unless the
///        free balance covers it, and the owner can only withdraw what is NOT reserved. So even
///        a compromised owner key cannot take rewards already promised to holders.
///      - The locking contract and the token are wired once and can never be changed.
contract VyraRewardPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IVyraLocking public locking;
    /// @notice Rewards promised to open locks and not yet paid out.
    uint256 public totalReserved;
    /// @notice Every reward ever paid to holders.
    uint256 public totalPaidOut;
    /// @notice Tokens added through `deposit` (owner seed, donations).
    uint256 public totalDeposited;
    /// @notice Tokens taken out by the owner.
    uint256 public totalWithdrawn;
    /// @notice Days already paid out, per lock id.
    mapping(uint64 lockId => uint16) public claimedDays;

    event LockingSet(address indexed locking);
    event Deposited(address indexed from, uint256 amount);
    event Reserved(uint256 indexed tokenId, uint64 indexed lockId, uint256 amount);
    event Claimed(
        address indexed owner, uint256 indexed tokenId, uint64 indexed lockId, uint16 daysPaid, uint256 amount
    );
    event Released(uint256 indexed tokenId, uint64 indexed lockId, uint256 amount);
    event SurplusWithdrawn(address indexed to, uint256 amount);

    error LockingAlreadySet();
    error NotLocking();
    error TokenNotSet();
    error NotLockOwner(uint256 tokenId);
    error InsufficientPool(uint256 needed, uint256 available);
    error ExceedsSurplus(uint256 requested, uint256 available);
    error CannotRescuePoolToken();
    error ZeroAddress();
    error ZeroAmount();
    error RenounceDisabled();

    modifier onlyLocking() {
        if (msg.sender != address(locking)) revert NotLocking();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function token() public view returns (IERC20 t) {
        if (address(locking) == address(0)) revert TokenNotSet();
        t = locking.token();
        if (address(t) == address(0)) revert TokenNotSet();
    }

    function balance() public view returns (uint256) {
        return token().balanceOf(address(this));
    }

    /// @notice Tokens not promised to anyone: what new locks draw on and what the owner may withdraw.
    function available() public view returns (uint256) {
        uint256 bal = balance();
        return bal > totalReserved ? bal - totalReserved : 0;
    }

    function rewardPerDay(IVyraLocking.Lock memory l) public pure returns (uint256) {
        return uint256(l.amount) * l.rateBps / BPS;
    }

    function maxReward(IVyraLocking.Lock memory l) public pure returns (uint256) {
        return rewardPerDay(l) * l.durationDays;
    }

    /// @notice Full 24h periods elapsed since lock start, capped at the lock duration.
    function daysElapsed(IVyraLocking.Lock memory l) public view returns (uint16) {
        if (l.owner == address(0)) return 0;
        uint256 d = (block.timestamp - l.start) / 1 days;
        // forge-lint: disable-next-line(unsafe-typecast) d <= durationDays (uint16) in this branch
        return d > l.durationDays ? l.durationDays : uint16(d);
    }

    function pendingOf(uint256 tokenId) public view returns (uint256) {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint16 due = daysElapsed(l);
        uint16 done = claimedDays[l.lockId];
        return due > done ? rewardPerDay(l) * (due - done) : 0;
    }

    function pendingMany(uint256[] calldata tokenIds) external view returns (uint256[] memory out, uint256 total) {
        out = new uint256[](tokenIds.length);
        for (uint256 i; i < tokenIds.length; ++i) {
            out[i] = pendingOf(tokenIds[i]);
            total += out[i];
        }
    }

    // ------------------------------------------------------------------
    // Holder & public actions
    // ------------------------------------------------------------------

    /// @notice Claim every accrued reward for the given locked guardians.
    /// @dev Intentionally not pausable: holders can always collect what they've earned.
    function claim(uint256[] calldata tokenIds) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < tokenIds.length; ++i) {
            IVyraLocking.Lock memory l = locking.lockOf(tokenIds[i]);
            if (l.owner != msg.sender) revert NotLockOwner(tokenIds[i]);
            total += _accrue(tokenIds[i], l);
        }
        if (total > 0) token().safeTransfer(msg.sender, total);
    }

    /// @notice Anyone may add tokens to the pool (the owner's seed, donations, buybacks).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token().safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Locking hooks
    // ------------------------------------------------------------------

    /// @notice Reserve the full-period reward for a freshly opened lock.
    function reserve(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 needed = maxReward(l);
        uint256 free = available();
        if (needed > free) revert InsufficientPool(needed, free);
        totalReserved += needed;
        emit Reserved(tokenId, l.lockId, needed);
    }

    /// @notice Release the reserve still held for a lock's remaining days. Called (after `settle`)
    ///         right before the lock's amount changes on a level-up.
    function release(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 remaining = rewardPerDay(l) * (l.durationDays - claimedDays[l.lockId]);
        totalReserved -= remaining;
        emit Released(tokenId, l.lockId, remaining);
    }

    /// @notice Reserve the remaining days of a lock at its (new) amount. Called after a level-up.
    function reserveRemaining(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 needed = rewardPerDay(l) * (l.durationDays - claimedDays[l.lockId]);
        uint256 free = available();
        if (needed > free) revert InsufficientPool(needed, free);
        totalReserved += needed;
        emit Reserved(tokenId, l.lockId, needed);
    }

    /// @notice Pay out everything left on a finished lock before it is closed or renewed.
    function settle(uint256 tokenId) external onlyLocking nonReentrant returns (uint256 amount) {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        amount = _accrue(tokenId, l);
        if (amount > 0) token().safeTransfer(l.owner, amount);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    /// @notice One-time wiring to the locking contract.
    function setLocking(address locking_) external onlyOwner {
        if (address(locking) != address(0)) revert LockingAlreadySet();
        if (locking_ == address(0)) revert ZeroAddress();
        locking = IVyraLocking(locking_);
        emit LockingSet(locking_);
    }

    /// @notice Withdraw pool tokens that are not reserved for any open lock.
    function withdrawSurplus(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 free = available();
        if (amount > free) revert ExceedsSurplus(amount, free);
        totalWithdrawn += amount;
        token().safeTransfer(to, amount);
        emit SurplusWithdrawn(to, amount);
    }

    /// @notice Recover unrelated tokens sent here by mistake. The pool token can never be rescued.
    function rescueERC20(IERC20 other, address to, uint256 amount) external onlyOwner {
        if (address(other) == address(token())) revert CannotRescuePoolToken();
        other.safeTransfer(to, amount);
    }

    /// @dev Disabled: an ownerless pool could never release its surplus.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _accrue(uint256 tokenId, IVyraLocking.Lock memory l) internal returns (uint256 amount) {
        uint16 due = daysElapsed(l);
        uint16 done = claimedDays[l.lockId];
        if (due <= done) return 0;
        amount = rewardPerDay(l) * (due - done);
        claimedDays[l.lockId] = due;
        totalReserved -= amount;
        totalPaidOut += amount;
        emit Claimed(l.owner, tokenId, l.lockId, due - done, amount);
    }
}
