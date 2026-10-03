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
    poolBalance,
    poolAvailable:
      poolBalance !== undefined && totalReserved !== undefined
        ? poolBalance > totalReserved
          ? poolBalance - totalReserved
          : 0n
        : undefined,
    nftApproved: t?.[6],
    /** Whether the NFT collection lets the locking contract move guardians; undefined while loading. */
    keepAllowed,
  };
}

export type Protocol = ReturnType<typeof useProtocol>;

/** Highest level index (0-based) that is configured for a tier, or -1 if the tier is closed. */
export function topLevel(cfg: TierConfig | undefined): number {
  if (!cfg) return -1;
  let top = -1;
  cfg.levels.forEach((lv, i) => {
    if (lv.maxAmount > 0n) top = i;
  });
  return top;
}
