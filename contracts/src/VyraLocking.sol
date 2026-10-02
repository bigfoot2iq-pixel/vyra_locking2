// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IVyraLocking} from "./interfaces/IVyraLocking.sol";

interface IRewardPool {
    function reserve(uint256 tokenId) external;
    function settle(uint256 tokenId) external returns (uint256);
    function release(uint256 tokenId) external;
    function reserveRemaining(uint256 tokenId) external;
}

/// @title VyraLocking
/// @notice Holders lock a VYRA guardian for a fixed period and pay a level-bounded amount of the
///         token into the {VyraRewardPool}; the pool pays daily rewards on that amount.
/// @dev Tiers match the collection's "Rarity" trait: 0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary.
///      Each token's tier is stored in a packed on-chain map (4 bits per token) uploaded by the owner.
///      Each tier has 5 levels (0-based here, shown as 1-5). A level sets the allowed lock amount.
///      The holder picks the level when locking or renewing: level 1 is free, a higher level costs
///      its price on top of the locked amount. A running lock can also level up: the holder pays
///      the fee difference plus a top-up, and the remaining days earn on the bigger amount.
///      Everything goes to the pool. Nothing is burned and this contract never keeps tokens.
contract VyraLocking is IVyraLocking, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    uint8 public constant TIER_COUNT = 5;
    uint8 public constant LEVEL_COUNT = 5;
    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_DURATION_DAYS = 365;
    uint16 public constant MAX_RATE_BPS = 10_000; // 100% of the lock per day
    /// @dev Rarity map packing: 64 tokens per word, 4 bits each.
    uint256 public constant TIERS_PER_WORD = 64;

    struct Level {
        uint128 minAmount;
        uint128 maxAmount; // 0 = level not available
        uint128 price; // fee to lock at this level; level 0 must be 0, non-decreasing
    }

    struct TierConfig {
        uint16 dailyRateBps;
        Level[LEVEL_COUNT] levels;
    }

    IERC721 public immutable nft;
    address public immutable pool;
    IERC20 public token;

    uint16 public durationDays = 7;
    bool public rarityLocked;

    TierConfig[TIER_COUNT] internal _tiers;
    /// @dev word index => 64 packed 4-bit tiers. Token id `i` lives in word i/64, nibble i%64.
    mapping(uint256 => uint256) internal _tierWords;

    mapping(uint256 tokenId => Lock) internal _locks;
    mapping(address owner => EnumerableSet.UintSet) internal _lockedBy;

    uint64 public nextLockId = 1;
    uint256 public totalLocked;
    /// @notice All tokens paid into the pool by lock payments.
    uint256 public totalLockPayments;
    /// @notice All tokens paid into the pool as level fees.
    uint256 public totalLevelPayments;

    event Locked(
        address indexed owner,
        uint256 indexed tokenId,
        uint64 indexed lockId,
        uint8 tier,
        uint8 level,
        uint256 amount,
        uint256 levelFee,
        uint40 end
    );
    event Renewed(
        address indexed owner,
        uint256 indexed tokenId,
        uint64 indexed lockId,
        uint8 tier,
        uint8 level,
        uint256 amount,
        uint256 levelFee,
        uint40 end
    );
    event Unlocked(address indexed owner, uint256 indexed tokenId);
    event LeveledUp(
        address indexed owner, uint256 indexed tokenId, uint8 fromLevel, uint8 toLevel, uint256 newAmount, uint256 paid
    );

    event TokenSet(address indexed token);
    event DurationSet(uint16 durationDays);
    event TierConfigSet(uint8 indexed tier, uint16 dailyRateBps);
    event RarityWordsSet(uint256 startWord, uint256 count);
    event RarityLocked();

    error TokenAlreadySet();
    error TokenNotSet();
    error ZeroAddress();
    error LengthMismatch();
    error EmptyInput();
    error NotTokenOwner(uint256 tokenId);
    error NotLocked(uint256 tokenId);
    error AlreadyLocked(uint256 tokenId);
    error LockNotEnded(uint256 tokenId, uint40 end);
    error LevelNotAvailable(uint8 tier, uint8 level);
    error AmountOutOfRange(uint256 tokenId, uint256 amount, uint128 min, uint128 max);
    error InvalidLevel(uint8 level);
    error LevelNotPriced(uint8 tier, uint8 level);
    error LockEnded(uint256 tokenId);
    error AmountBelowLocked(uint256 tokenId, uint256 amount, uint256 locked);
    error InvalidTier(uint8 tier);
    error InvalidTierConfig(uint8 tier, uint8 level);
    error InvalidBps(uint16 bps);
    error InvalidDuration(uint16 durationDays);
    error InvalidRarityWord(uint256 wordIndex, uint256 slot);
    error RarityIsLocked();
    error TokenIsLocked(uint256 tokenId);
    error FeeOnTransferToken();
    error RenounceDisabled();

    constructor(address initialOwner, IERC721 nft_, address pool_) Ownable(initialOwner) {
        if (address(nft_) == address(0) || pool_ == address(0)) revert ZeroAddress();
        nft = nft_;
        pool = pool_;
    }

    // ------------------------------------------------------------------
    // Holder actions
    // ------------------------------------------------------------------

    /// @notice Lock guardians at the chosen levels.
    /// @param levels 0-based level per token (UI level - 1). Level 1 is free; a higher level costs
    ///        its price, paid into the pool on top of the amount.
    /// @param amounts must sit inside the chosen level's range for the token's tier.
    /// @dev Requires NFT approval (setApprovalForAll) and token allowance for sum(amounts + fees).
    function lock(uint256[] calldata tokenIds, uint256[] calldata amounts, uint8[] calldata levels)
        external
        whenNotPaused
        nonReentrant
    {
        (uint256 total, uint256 fees) = _quote(tokenIds, amounts, levels);
        _collect(total, fees); // payment lands in the pool first so it can back this lock's own reserve
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            if (_locks[id].owner != address(0)) revert AlreadyLocked(id);
            if (nft.ownerOf(id) != msg.sender) revert NotTokenOwner(id);
            _lockedBy[msg.sender].add(id);
            _openLock(id, amounts[i], levels[i], false);
            nft.transferFrom(msg.sender, address(this), id);
        }
        totalLocked += tokenIds.length;
    }

    /// @notice Start a new period on finished locks without moving the NFT, at newly chosen levels.
    ///         Remaining rewards from the finished period are paid out first.
    function renew(uint256[] calldata tokenIds, uint256[] calldata amounts, uint8[] calldata levels)
        external
        whenNotPaused
        nonReentrant
    {
        (uint256 total, uint256 fees) = _quote(tokenIds, amounts, levels);
        _collect(total, fees);
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            _requireEndedLockOf(id);
            IRewardPool(pool).settle(id);
            _openLock(id, amounts[i], levels[i], true);
        }
    }

    /// @notice Raise a running lock to a higher level and lock more.
    ///         Pays: (new level fee - current level fee) + (newAmount - locked amount), into the pool.
    ///         Tribute earned so far is paid out first; the remaining days earn on `newAmount`.
    ///         The end date does not change. Only while the lock is running.
    /// @param newLevel 0-based target level, above the current one.
    /// @param newAmount total locked after the level-up: inside the new level's range and not below
    ///        what is already locked.
    function levelUp(uint256 tokenId, uint8 newLevel, uint256 newAmount) external whenNotPaused nonReentrant {
        Lock storage l = _locks[tokenId];
        if (l.owner == address(0)) revert NotLocked(tokenId);
        if (l.owner != msg.sender) revert NotTokenOwner(tokenId);
        if (block.timestamp >= endOf(tokenId)) revert LockEnded(tokenId);
        if (newLevel >= LEVEL_COUNT || newLevel <= l.level) revert InvalidLevel(newLevel);

        uint8 tier = l.tier;
        Level memory target = _tiers[tier].levels[newLevel];
        if (target.maxAmount == 0) revert LevelNotAvailable(tier, newLevel);
        if (target.price == 0) revert LevelNotPriced(tier, newLevel);
        if (newAmount < l.amount) revert AmountBelowLocked(tokenId, newAmount, l.amount);
        if (newAmount < target.minAmount || newAmount > target.maxAmount) {
            revert AmountOutOfRange(tokenId, newAmount, target.minAmount, target.maxAmount);
        }

        // fee difference vs. the level already paid for in this period (prices never decrease)
        uint256 feeDiff = target.price - _levelFeePaid(tier, l.level);
        uint256 topUp = newAmount - l.amount;
        uint8 fromLevel = l.level;

        IRewardPool(pool).settle(tokenId); // pay earned days at the old amount
        IRewardPool(pool).release(tokenId); // free the old reserve for the remaining days
        _collect(topUp, feeDiff);
        l.level = newLevel;
        // forge-lint: disable-next-line(unsafe-typecast) newAmount <= target.maxAmount (uint128)
        l.amount = uint128(newAmount);
        IRewardPool(pool).reserveRemaining(tokenId); // reserve the remaining days at the new amount

        emit LeveledUp(msg.sender, tokenId, fromLevel, newLevel, newAmount, topUp + feeDiff);
    }

    /// @notice Pay out remaining rewards and return the NFT. Only after the period ends.
    /// @dev Intentionally not pausable: holders can always get their guardian back.
    function unlock(uint256[] calldata tokenIds) external nonReentrant {
        if (tokenIds.length == 0) revert EmptyInput();
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            _requireEndedLockOf(id);
            IRewardPool(pool).settle(id);
            delete _locks[id];
            _lockedBy[msg.sender].remove(id);
            emit Unlocked(msg.sender, id);
            nft.transferFrom(address(this), msg.sender, id);
        }
        totalLocked -= tokenIds.length;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function lockOf(uint256 tokenId) external view returns (Lock memory) {
        return _locks[tokenId];
    }

    function locksOf(uint256[] calldata tokenIds) external view returns (Lock[] memory out) {
        out = new Lock[](tokenIds.length);
        for (uint256 i; i < tokenIds.length; ++i) {
            out[i] = _locks[tokenIds[i]];
        }
    }

    function endOf(uint256 tokenId) public view returns (uint40) {
        Lock storage l = _locks[tokenId];
        return l.start + uint40(l.durationDays) * 1 days;
    }

    function lockedTokensOf(address owner) external view returns (uint256[] memory) {
        return _lockedBy[owner].values();
    }

    function tierConfig(uint8 tier) external view returns (TierConfig memory) {
        if (tier >= TIER_COUNT) revert InvalidTier(tier);
        return _tiers[tier];
    }

    function tierConfigs() external view returns (TierConfig[TIER_COUNT] memory) {
        return _tiers;
    }

    /// @notice Packed rarity words `[start, start + count)`, for verifying the uploaded map.
    function rarityWords(uint256 start, uint256 count) external view returns (uint256[] memory out) {
        out = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            out[i] = _tierWords[start + i];
        }
    }

    /// @notice Rarity tier of a token from the on-chain map (Common until the map is uploaded).
    function baseTierOf(uint256 tokenId) public view returns (uint8) {
        uint256 word = _tierWords[tokenId / TIERS_PER_WORD];
        // forge-lint: disable-next-line(unsafe-typecast) masked to 4 bits
        return uint8((word >> ((tokenId % TIERS_PER_WORD) * 4)) & 0xF);
    }

    /// @notice Fee to lock a token of `tier` at `level` (0-based). Level 1 is always free.
    function levelPrice(uint8 tier, uint8 level) public view returns (uint256) {
        if (tier >= TIER_COUNT) revert InvalidTier(tier);
        if (level >= LEVEL_COUNT) revert InvalidLevel(level);
        return _tiers[tier].levels[level].price;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice One-time: the lock/reward token. Fixed afterwards so pool accounting stays sound.
    function setToken(IERC20 token_) external onlyOwner {
        if (address(token) != address(0)) revert TokenAlreadySet();
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        emit TokenSet(address(token_));
    }

    /// @notice Period length for new locks and renewals. Running locks keep their snapshot.
    function setDurationDays(uint16 days_) external onlyOwner {
        if (days_ == 0 || days_ > MAX_DURATION_DAYS) revert InvalidDuration(days_);
        durationDays = days_;
        emit DurationSet(days_);
    }

    function setTierConfig(uint8 tier, TierConfig calldata cfg) external onlyOwner {
        _setTierConfig(tier, cfg);
    }

    function setTierConfigs(TierConfig[TIER_COUNT] calldata cfgs) external onlyOwner {
        for (uint8 t; t < TIER_COUNT; ++t) {
            _setTierConfig(t, cfgs[t]);
        }
    }

    /// @notice Write packed rarity words starting at word `startWord`. Each word holds 64 tokens,
    ///         4 bits each (token id `i` → word i/64, bits (i%64)*4). Every nibble must be a valid tier.
    function setRarityWords(uint256 startWord, uint256[] calldata words) external onlyOwner {
        if (rarityLocked) revert RarityIsLocked();
        for (uint256 i; i < words.length; ++i) {
            uint256 w = words[i];
            for (uint256 slot; slot < TIERS_PER_WORD; ++slot) {
                if ((w >> (slot * 4)) & 0xF >= TIER_COUNT) revert InvalidRarityWord(startWord + i, slot);
            }
            _tierWords[startWord + i] = w;
        }
        emit RarityWordsSet(startWord, words.length);
    }

    /// @notice Permanently freeze rarity ranges so holders can trust them.
    function lockRarity() external onlyOwner {
        rarityLocked = true;
        emit RarityLocked();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Return an NFT sent here directly (not through lock()).
    function rescueERC721(uint256 tokenId, address to) external onlyOwner {
        if (_locks[tokenId].owner != address(0)) revert TokenIsLocked(tokenId);
        nft.transferFrom(address(this), to, tokenId);
    }

    /// @notice This contract never holds tokens between calls; recover anything sent by mistake.
    function rescueERC20(IERC20 other, address to, uint256 amount) external onlyOwner {
        other.safeTransfer(to, amount);
    }

    /// @dev Disabled: an ownerless Keep could never be paused or configured again.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Validates inputs and prices the batch: locked amounts and level fees.
    function _quote(uint256[] calldata tokenIds, uint256[] calldata amounts, uint8[] calldata levels)
        internal
        view
        returns (uint256 total, uint256 fees)
    {
        if (address(token) == address(0)) revert TokenNotSet();
        if (tokenIds.length == 0) revert EmptyInput();
        if (tokenIds.length != amounts.length || tokenIds.length != levels.length) revert LengthMismatch();
        for (uint256 i; i < tokenIds.length; ++i) {
            uint8 level = levels[i];
            if (level >= LEVEL_COUNT) revert InvalidLevel(level);
            uint8 tier = baseTierOf(tokenIds[i]);
            uint256 price = _tiers[tier].levels[level].price;
            // a paid level with no price is a misconfiguration, never a free upgrade
            if (level > 0 && price == 0) revert LevelNotPriced(tier, level);
            total += amounts[i];
            fees += price;
        }
    }

    function _requireEndedLockOf(uint256 id) internal view {
        Lock storage l = _locks[id];
        if (l.owner == address(0)) revert NotLocked(id);
        if (l.owner != msg.sender) revert NotTokenOwner(id);
        uint40 end = endOf(id);
        if (block.timestamp < end) revert LockNotEnded(id, end);
    }

    /// @dev Fee charged for `level` of `tier` (the current config; prices only climb across levels).
    function _levelFeePaid(uint8 tier, uint8 level) internal view returns (uint256) {
        return _tiers[tier].levels[level].price;
    }

    /// @dev Writes a fresh snapshot for `id` at `level`, reserves its rewards and emits the event.
    function _openLock(uint256 id, uint256 amount, uint8 level, bool renewal) internal {
        uint8 tier = baseTierOf(id);

        TierConfig storage cfg = _tiers[tier];
        Level memory lv = cfg.levels[level];
        if (lv.maxAmount == 0) revert LevelNotAvailable(tier, level);
        if (amount < lv.minAmount || amount > lv.maxAmount) {
            revert AmountOutOfRange(id, amount, lv.minAmount, lv.maxAmount);
        }

        uint64 lockId = nextLockId++;
        uint16 d = durationDays;
        _locks[id] = Lock({
            owner: msg.sender,
            tier: tier,
            level: level,
            rateBps: cfg.dailyRateBps,
            durationDays: d,
            start: uint40(block.timestamp),
            lockId: lockId,
            // forge-lint: disable-next-line(unsafe-typecast) amount <= lv.maxAmount (uint128)
            amount: uint128(amount)
        });
        uint40 end = uint40(block.timestamp) + uint40(d) * 1 days;
        IRewardPool(pool).reserve(id);
        if (renewal) emit Renewed(msg.sender, id, lockId, tier, level, amount, lv.price, end);
        else emit Locked(msg.sender, id, lockId, tier, level, amount, lv.price, end);
    }

    /// @dev Moves lock amounts + level fees from the caller straight into the pool.
    ///      Rejects fee-on-transfer tokens.
    function _collect(uint256 total, uint256 fees) internal {
        totalLockPayments += total;
        totalLevelPayments += fees;
        uint256 amount = total + fees;
        if (amount == 0) return;
        IERC20 t = token;
        uint256 before = t.balanceOf(pool);
        t.safeTransferFrom(msg.sender, pool, amount);
        if (t.balanceOf(pool) - before != amount) revert FeeOnTransferToken();
    }

    function _setTierConfig(uint8 tier, TierConfig calldata cfg) internal {
        if (tier >= TIER_COUNT) revert InvalidTier(tier);
        if (cfg.dailyRateBps > MAX_RATE_BPS) revert InvalidBps(cfg.dailyRateBps);
        if (cfg.levels[0].price != 0) revert InvalidTierConfig(tier, 0);
        for (uint8 i; i < LEVEL_COUNT; ++i) {
            Level calldata lv = cfg.levels[i];
            if (lv.minAmount > lv.maxAmount) revert InvalidTierConfig(tier, i);
            if (i > 0) {
                Level calldata prev = cfg.levels[i - 1];
                // levels climb: never a lower cap or a cheaper price than the level below
                if (lv.maxAmount != 0 && (lv.maxAmount < prev.maxAmount || prev.maxAmount == 0)) {
                    revert InvalidTierConfig(tier, i);
                }
                if (lv.price < prev.price) revert InvalidTierConfig(tier, i);
            }
        }
        _tiers[tier] = cfg;
        emit TierConfigSet(tier, cfg.dailyRateBps);
    }
}
