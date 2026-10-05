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
///        unlock/renew/emergency return (to the lock owner), and `withdrawSurplus` by the owner.
///      - When a lock opens, its full-period reward is reserved. A lock cannot open unless the
///        free balance covers it, and the owner can only withdraw what is NOT reserved. So even
///        a compromised owner key cannot take rewards already promised to holders.
///      - The locking contract is wired once and can never be changed.
///      - The payment token can be switched on the locking contract. Every lock remembers the token
///        it was paid in, and the pool keeps reserves and stats per token, so a switch never
///        touches what was promised in the old token: those locks are paid out in it to the end.
contract VyraRewardPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IVyraLocking public locking;
    /// @notice Rewards promised to open locks and not yet paid out, per token.
    mapping(IERC20 token => uint256) public reservedOf;
    /// @notice Every reward ever paid to holders, per token.
    mapping(IERC20 token => uint256) public paidOutOf;
    /// @notice Tokens added through `deposit` (owner seed, donations), per token.
    mapping(IERC20 token => uint256) public depositedOf;
    /// @notice Tokens taken out by the owner, per token.
    mapping(IERC20 token => uint256) public withdrawnOf;
    /// @notice Days already paid out, per lock id.
    mapping(uint64 lockId => uint16) public claimedDays;

    event LockingSet(address indexed locking);
    event Deposited(address indexed from, uint256 amount);
    event Reserved(uint256 indexed tokenId, uint64 indexed lockId, uint256 amount);
    event Claimed(
        address indexed owner, uint256 indexed tokenId, uint64 indexed lockId, uint16 daysPaid, uint256 amount
    );
    event Released(uint256 indexed tokenId, uint64 indexed lockId, uint256 amount);
    event SurplusWithdrawn(address indexed token, address indexed to, uint256 amount);

    error LockingAlreadySet();
    error NotLocking();
    error TokenNotSet();
    error NotLockOwner(uint256 tokenId);
    error InsufficientPool(uint256 needed, uint256 available);
    error ExceedsSurplus(uint256 requested, uint256 available);
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

    /// @notice Tokens not promised to anyone, in the current token: what new locks draw on and what
    ///         the owner may withdraw.
    function available() public view returns (uint256) {
        return availableOf(token());
    }

    /// @notice Unreserved balance of any token (an old payment token, or one sent by mistake).
    function availableOf(IERC20 t) public view returns (uint256) {
        uint256 bal = t.balanceOf(address(this));
        uint256 r = reservedOf[t];
        return bal > r ? bal - r : 0;
    }

    /// @notice Rewards promised in the current token (zero until it is set).
    function totalReserved() external view returns (uint256) {
        return reservedOf[_current()];
    }

    /// @notice Rewards paid in the current token.
    function totalPaidOut() external view returns (uint256) {
        return paidOutOf[_current()];
    }

    /// @notice Deposits in the current token.
    function totalDeposited() external view returns (uint256) {
        return depositedOf[_current()];
    }

    /// @notice Owner withdrawals in the current token.
    function totalWithdrawn() external view returns (uint256) {
        return withdrawnOf[_current()];
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

    /// @notice Claim every accrued reward for the given locked guardians. Each lock pays in the
    ///         token it was paid in, so after a switch `total` adds up amounts of different tokens.
    /// @dev Intentionally not pausable: holders can always collect what they've earned.
    function claim(uint256[] calldata tokenIds) external nonReentrant returns (uint256 total) {
        IERC20 t;
        uint256 owed;
        for (uint256 i; i < tokenIds.length; ++i) {
            IVyraLocking.Lock memory l = locking.lockOf(tokenIds[i]);
            if (l.owner != msg.sender) revert NotLockOwner(tokenIds[i]);
            if (l.token != t) {
                if (owed > 0) t.safeTransfer(msg.sender, owed);
                (t, owed) = (l.token, 0);
            }
            uint256 amount = _accrue(tokenIds[i], l);
            owed += amount;
            total += amount;
        }
        if (owed > 0) t.safeTransfer(msg.sender, owed);
    }

    /// @notice Anyone may add tokens to the pool (the owner's seed, donations, buybacks).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 t = token();
        t.safeTransferFrom(msg.sender, address(this), amount);
        depositedOf[t] += amount;
        emit Deposited(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Locking hooks
    // ------------------------------------------------------------------

    /// @notice Reserve the full-period reward for a freshly opened lock.
    function reserve(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 needed = maxReward(l);
        uint256 free = availableOf(l.token);
        if (needed > free) revert InsufficientPool(needed, free);
        reservedOf[l.token] += needed;
        emit Reserved(tokenId, l.lockId, needed);
    }

    /// @notice Release the reserve still held for a lock's remaining days. Called (after `settle`)
    ///         right before the lock's amount changes on a level-up.
    function release(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 remaining = rewardPerDay(l) * (l.durationDays - claimedDays[l.lockId]);
        reservedOf[l.token] -= remaining;
        emit Released(tokenId, l.lockId, remaining);
    }

    /// @notice Reserve the remaining days of a lock at its (new) amount. Called after a level-up.
    function reserveRemaining(uint256 tokenId) external onlyLocking {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        uint256 needed = rewardPerDay(l) * (l.durationDays - claimedDays[l.lockId]);
        uint256 free = availableOf(l.token);
        if (needed > free) revert InsufficientPool(needed, free);
        reservedOf[l.token] += needed;
        emit Reserved(tokenId, l.lockId, needed);
    }

    /// @notice Pay out everything left on a finished lock before it is closed or renewed.
    function settle(uint256 tokenId) external onlyLocking nonReentrant returns (uint256 amount) {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        amount = _accrue(tokenId, l);
        if (amount > 0) l.token.safeTransfer(l.owner, amount);
    }

    /// @notice Pay out the whole period's remaining reward, days not yet elapsed included, before
    ///         the owner hands a guardian back early. It was reserved when the lock opened, so the
    ///         pool always covers it and the holder is never short-changed by an emergency return.
    function settleFull(uint256 tokenId) external onlyLocking nonReentrant returns (uint256 amount) {
        IVyraLocking.Lock memory l = locking.lockOf(tokenId);
        amount = _accrueTo(tokenId, l, l.durationDays);
        if (amount > 0) l.token.safeTransfer(l.owner, amount);
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

    /// @notice Withdraw current-token pool tokens that are not reserved for any open lock.
    function withdrawSurplus(address to, uint256 amount) external onlyOwner nonReentrant {
        _withdraw(token(), to, amount);
    }

    /// @notice Withdraw the unreserved balance of any token: what is left of an old payment token
    ///         after a switch, or tokens sent here by mistake. Reserved rewards can never leave.
    function withdrawSurplusOf(IERC20 t, address to, uint256 amount) external onlyOwner nonReentrant {
        _withdraw(t, to, amount);
    }

    /// @dev Disabled: an ownerless pool could never release its surplus.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _current() internal view returns (IERC20) {
        return address(locking) == address(0) ? IERC20(address(0)) : locking.token();
    }

    function _withdraw(IERC20 t, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 free = availableOf(t);
        if (amount > free) revert ExceedsSurplus(amount, free);
        withdrawnOf[t] += amount;
        t.safeTransfer(to, amount);
        emit SurplusWithdrawn(address(t), to, amount);
    }

    function _accrue(uint256 tokenId, IVyraLocking.Lock memory l) internal returns (uint256 amount) {
        return _accrueTo(tokenId, l, daysElapsed(l));
    }

    /// @dev Pays `l` up to day `due` (at most its duration) and draws it from the reserve.
    function _accrueTo(uint256 tokenId, IVyraLocking.Lock memory l, uint16 due) internal returns (uint256 amount) {
        uint16 done = claimedDays[l.lockId];
        if (due <= done) return 0;
        amount = rewardPerDay(l) * (due - done);
        claimedDays[l.lockId] = due;
        reservedOf[l.token] -= amount;
        paidOutOf[l.token] += amount;
        emit Claimed(l.owner, tokenId, l.lockId, due - done, amount);
    }
}
