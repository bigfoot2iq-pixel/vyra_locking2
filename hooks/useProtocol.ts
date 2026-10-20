"use client";

import { erc20Abi, erc721Abi, parseAbi, zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { vyraLockingAbi, vyraRewardPoolAbi } from "@/lib/abis";
import { addresses, isConfigured } from "@/lib/env";

const locking = { address: addresses.locking!, abi: vyraLockingAbi } as const;
const pool = { address: addresses.pool!, abi: vyraRewardPoolAbi } as const;

export const LEVEL_COUNT = 5;

// Creator-token collections (OpenSea's ERC721-C) only let allow-listed contracts move NFTs.
const validatorAbi = parseAbi([
  "function getTransferValidator() view returns (address)",
  "function isAccountWhitelistedByCollection(address collection, address account) view returns (bool)",
]);

export interface Level {
  minAmount: bigint;
  maxAmount: bigint;
  /** Fee to lock at this level; level 1 is always 0. */
  price: bigint;
}

export interface TierConfig {
  dailyRateBps: number;
  levels: readonly Level[];
}

/** Everything global about the Keep plus the connected wallet's balances/approvals. */
export function useProtocol() {
  const { address: user } = useAccount();

  const core = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...locking, functionName: "token" },
      { ...locking, functionName: "durationDays" },
      { ...locking, functionName: "tierConfigs" },
      { ...locking, functionName: "paused" },
      { ...locking, functionName: "owner" },
      { ...locking, functionName: "pendingOwner" },
      { ...locking, functionName: "totalLocked" },
      { ...locking, functionName: "rarityLocked" },
      { ...locking, functionName: "rarityWords", args: [0n, 18n] },
      { ...locking, functionName: "totalLockPayments" },
      { ...locking, functionName: "totalLevelPayments" },
      { ...pool, functionName: "totalReserved" },
      { ...pool, functionName: "owner" },
      { ...pool, functionName: "pendingOwner" },
      { ...pool, functionName: "totalPaidOut" },
      { ...pool, functionName: "totalDeposited" },
      { ...pool, functionName: "totalWithdrawn" },
    ],
    query: { enabled: isConfigured, refetchInterval: 30_000 },
  });

  const d = core.data;
  const token = d?.[0] as Address | undefined;
  const tokenSet = !!token && token !== zeroAddress;
  const u = user ?? zeroAddress;

  const tok = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: token!, abi: erc20Abi, functionName: "symbol" },
      { address: token!, abi: erc20Abi, functionName: "decimals" },
      { address: token!, abi: erc20Abi, functionName: "balanceOf", args: [u] },
      { address: token!, abi: erc20Abi, functionName: "allowance", args: [u, addresses.locking!] },
      { address: token!, abi: erc20Abi, functionName: "allowance", args: [u, addresses.pool!] },
      { address: token!, abi: erc20Abi, functionName: "balanceOf", args: [addresses.pool!] },
      { address: addresses.nft!, abi: erc721Abi, functionName: "isApprovedForAll", args: [u, addresses.locking!] },
    ],
    query: { enabled: isConfigured && tokenSet, refetchInterval: 30_000 },
  });

  const validator = useReadContract({
    address: addresses.nft,
    abi: validatorAbi,
    functionName: "getTransferValidator",
    query: { enabled: isConfigured, retry: false, staleTime: Infinity },
  });
  const validatorAddr = validator.data && validator.data !== zeroAddress ? validator.data : undefined;
  const allowList = useReadContract({
    address: validatorAddr,
    abi: validatorAbi,
    functionName: "isAccountWhitelistedByCollection",
    args: [addresses.nft!, addresses.locking!],
    query: { enabled: !!validatorAddr, refetchInterval: 30_000 },
  });
  // No validator (or the call isn't supported) means no transfer restrictions.
  const keepAllowed = validator.isError || (validator.isSuccess && !validatorAddr) ? true : allowList.data;

  const t = tok.data;
  const poolBalance = t?.[5];
  const totalReserved = d?.[11];

  return {
    isLoading: core.isLoading || (tokenSet && tok.isLoading),
    error: core.error ?? tok.error,
    token: tokenSet ? token : undefined,
    durationDays: d?.[1],
    tiers: d?.[2] as readonly TierConfig[] | undefined,
    paused: d?.[3],
    owner: d?.[4],
    pendingOwner: d?.[5],
    totalLocked: d?.[6],
    rarityLocked: d?.[7],
    rarityWords: d?.[8],
    totalLockPayments: d?.[9],
    totalLevelPayments: d?.[10],
    totalReserved,
    poolOwner: d?.[12],
    poolPendingOwner: d?.[13],
    totalPaidOut: d?.[14],
    totalDeposited: d?.[15],
    totalWithdrawn: d?.[16],
    symbol: t?.[0] ?? "TOKEN",
    decimals: t?.[1] ?? 18,
    balance: t?.[2],
    allowanceLocking: t?.[3],
    allowancePool: t?.[4],
    /** The whole pool pays tribute: every lock payment, level fee and deposit lands here. */
    poolBalance,
    /** Free for new locks' tribute and owner withdrawals: not promised to a running lock. */
    poolAvailable: poolBalance !== undefined && totalReserved !== undefined ? sub(poolBalance, totalReserved) : undefined,
    nftApproved: t?.[6],
    /** Whether the NFT collection lets the locking contract move guardians; undefined while loading. */
    keepAllowed,
  };
}

export type Protocol = ReturnType<typeof useProtocol>;

const sub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

/** Highest level index (0-based) that is configured for a tier, or -1 if the tier is closed. */
export function topLevel(cfg: TierConfig | undefined): number {
  if (!cfg) return -1;
  let top = -1;
  cfg.levels.forEach((lv, i) => {
    if (lv.maxAmount > 0n) top = i;
  });
  return top;
}

/** Tribute of a whole lock: its daily rate on everything paid for it (amount + level fee), times its days. The profit. */
export function lockTribute(amount: bigint, fee: bigint, rateBps: number | bigint, days: number | bigint): bigint {
  return ((amount + fee) * BigInt(rateBps) * BigInt(days)) / 10_000n;
}

/** Everything a lock pays back over its period: the payment (amount + fee) plus its tribute (the pool's `maxReward`). */
export function lockPayout(amount: bigint, fee: bigint, rateBps: number | bigint, days: number | bigint): bigint {
  return amount + fee + lockTribute(amount, fee, rateBps, days);
}

/** What a lock pays each day: its whole payout spread evenly over its days (the pool's `rewardPerDay`). */
export function dailyPayout(amount: bigint, fee: bigint, rateBps: number | bigint, days: number | bigint): bigint {
  return BigInt(days) > 0n ? lockPayout(amount, fee, rateBps, days) / BigInt(days) : 0n;
}

/** The biggest lock a tier allows: its top level's max amount + fee, what it pays back and pays a day. */
export function bestLock(cfg: TierConfig | undefined, durationDays: number | bigint | undefined) {
  const top = topLevel(cfg);
  if (!cfg || top < 0 || durationDays === undefined) return undefined;
  const lv = cfg.levels[top];
  const args = [lv.maxAmount, lv.price, cfg.dailyRateBps, durationDays] as const;
  return { level: top, paid: lv.maxAmount + lv.price, tribute: lockTribute(...args), payout: lockPayout(...args), daily: dailyPayout(...args) };
}

/** Most tribute (profit on top of the payment) one new lock in this tier can earn. */
export function maxTribute(cfg: TierConfig | undefined, durationDays: number | bigint | undefined): bigint | undefined {
  return bestLock(cfg, durationDays)?.tribute;
}
