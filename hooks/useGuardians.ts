"use client";

import { useQuery } from "@tanstack/react-query";
import { erc721Abi, parseAbi, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { vyraLockingAbi, vyraRewardPoolAbi } from "@/lib/abis";
import { addresses, explorerUrl, isConfigured } from "@/lib/env";
import { DAY } from "@/lib/format";

const enumerableAbi = parseAbi(["function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)"]);

export interface LockInfo {
  tier: number;
  /** 0-based level used for this period. */
  level: number;
  rateBps: number;
  durationDays: number;
  start: number;
  end: number;
  lockId: bigint;
  amount: bigint;
  /** Token this period was paid in; its rewards come in the same token. */
  token: Address;
}

export interface Guardian {
  id: bigint;
  locked: boolean;
  /** Rarity tier from the owner-set id ranges. */
  tier: number;
  lock?: LockInfo;
  /** Claimable right now (locked only). */
  pending?: bigint;
  claimedDays?: number;
}

/** Ids the wallet holds. Uses ERC721Enumerable when available, else the Blockscout explorer API. */
async function fetchWalletIds(client: PublicClient, user: Address): Promise<bigint[]> {
  const nft = addresses.nft!;
  const balance = await client.readContract({ address: nft, abi: erc721Abi, functionName: "balanceOf", args: [user] });
  if (balance === 0n) return [];

  try {
    const ids = await Promise.all(
      Array.from({ length: Number(balance) }, (_, i) =>
        client.readContract({
          address: nft,
          abi: enumerableAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [user, BigInt(i)],
        }),
      ),
    );
    return ids.sort((a, b) => (a < b ? -1 : 1));
  } catch {
    return ownedOnChain(client, user, [...(await fetchIdsFromExplorer(user)), ...recentlyReturned]);
  }
}

/**
 * The explorer indexes a few blocks behind, so right after a lock it still lists the guardian and
 * right after an unlock it doesn't list it yet. Guardians returned by an unlock this session are
 * added back, and every id is confirmed with ownerOf so the wallet list always matches the chain.
 */
const recentlyReturned = new Set<bigint>();
export function noteReturned(ids: readonly bigint[]) {
  ids.forEach((id) => recentlyReturned.add(id));
}

async function ownedOnChain(client: PublicClient, user: Address, ids: bigint[]): Promise<bigint[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const owners = await client.multicall({
    allowFailure: true,
    contracts: unique.map((id) => ({ address: addresses.nft!, abi: erc721Abi, functionName: "ownerOf", args: [id] }) as const),
  });
  return unique
    .filter((_, i) => owners[i].status === "success" && (owners[i].result as Address).toLowerCase() === user.toLowerCase())
    .sort((a, b) => (a < b ? -1 : 1));
}

interface BlockscoutNftPage {
  items: { id: string; token: { address?: string; address_hash?: string } }[];
  next_page_params: Record<string, string | number> | null;
}

async function fetchIdsFromExplorer(user: Address): Promise<bigint[]> {
  if (!explorerUrl) return [];
  const nft = addresses.nft!.toLowerCase();
  const ids: bigint[] = [];
  let params: Record<string, string | number> | null = { type: "ERC-721" };
  for (let page = 0; params && page < 20; page++) {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    qs.set("type", "ERC-721");
    const res = await fetch(`${explorerUrl}/api/v2/addresses/${user}/nft?${qs}`);
    if (!res.ok) break;
    const body = (await res.json()) as BlockscoutNftPage;
    for (const it of body.items) {
      const addr = (it.token.address_hash ?? it.token.address ?? "").toLowerCase();
      if (addr === nft) ids.push(BigInt(it.id));
    }
    params = body.next_page_params;
  }
  return ids.sort((a, b) => (a < b ? -1 : 1));
}

export function useGuardians() {
  const { address: user } = useAccount();
  const client = usePublicClient();
  const enabled = isConfigured && !!user;

  const wallet = useQuery({
    queryKey: ["walletGuardians", user, addresses.nft],
    queryFn: () => fetchWalletIds(client!, user!),
    enabled: enabled && !!client,
    refetchInterval: 60_000,
  });

  const lockedQ = useReadContract({
    address: addresses.locking,
    abi: vyraLockingAbi,
    functionName: "lockedTokensOf",
    args: user ? [user] : undefined,
    query: { enabled, refetchInterval: 30_000 },
  });

  const lockedIds = [...(lockedQ.data ?? [])].sort((a, b) => (a < b ? -1 : 1));
  // Never show a guardian twice, even if a stale wallet read still lists one that is now locked.
  const lockedSet = new Set(lockedIds);
  const walletIds = (wallet.data ?? []).filter((id) => !lockedSet.has(id));
  const allIds = [...lockedIds, ...walletIds];

  const perToken = useReadContracts({
    allowFailure: false,
    contracts: allIds.map(
      (id) => ({ address: addresses.locking!, abi: vyraLockingAbi, functionName: "baseTierOf", args: [id] }) as const,
    ),
    query: { enabled: enabled && allIds.length > 0, refetchInterval: 30_000 },
  });

  const locks = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: addresses.locking!, abi: vyraLockingAbi, functionName: "locksOf", args: [lockedIds] },
      { address: addresses.pool!, abi: vyraRewardPoolAbi, functionName: "pendingMany", args: [lockedIds] },
    ],
    query: { enabled: enabled && lockedIds.length > 0, refetchInterval: 15_000 },
  });

  const lockRecords = locks.data?.[0] ?? [];
  const claimed = useReadContracts({
    allowFailure: false,
    contracts: lockRecords.map(
      (l) => ({ address: addresses.pool!, abi: vyraRewardPoolAbi, functionName: "claimedDays", args: [l.lockId] }) as const,
    ),
    query: { enabled: lockRecords.length > 0, refetchInterval: 15_000 },
  });

  const pendingAmounts = locks.data?.[1]?.[0] ?? [];
  const info = perToken.data ?? [];

  const guardians: Guardian[] = allIds.map((id, i) => {
    const locked = i < lockedIds.length;
    const g: Guardian = {
      id,
      locked,
      tier: Number(info[i] ?? 0),
    };
    const l = locked ? lockRecords[i] : undefined;
    if (l) {
      g.lock = {
        tier: l.tier,
        level: l.level,
        rateBps: l.rateBps,
        durationDays: l.durationDays,
        start: Number(l.start),
        end: Number(l.start) + l.durationDays * DAY,
        lockId: l.lockId,
        amount: l.amount,
        token: l.token,
      };
      g.pending = pendingAmounts[i];
      g.claimedDays = claimed.data?.[i] !== undefined ? Number(claimed.data[i]) : undefined;
    }
    return g;
  });

  const infoReady = allIds.length === 0 || !!perToken.data;
  const locksReady = lockedIds.length === 0 || !!locks.data;

  const error = wallet.error ?? lockedQ.error ?? perToken.error ?? locks.error;
  const pending = wallet.isLoading || lockedQ.isLoading || !infoReady || !locksReady;
  // a read that failed before its data arrived would otherwise leave skeletons up forever
  const failed = enabled && pending && !!error;

  return {
    guardians,
    locked: guardians.filter((g) => g.locked),
    idle: guardians.filter((g) => !g.locked),
    totalPending: pendingAmounts.reduce((a, b) => a + b, 0n),
    isLoading: enabled && pending && !failed,
    failed,
    error,
  };
}

/** Completed days earned but not yet claimed (each day of vigil is one claim). Undefined until claim data loads. */
export function unclaimedDays(g: Guardian, now: number): number | undefined {
  const l = g.lock;
  if (!l || g.claimedDays === undefined) return undefined;
  const full = Math.min(Math.floor(Math.max(0, now - l.start) / DAY), l.durationDays);
  return Math.max(0, full - g.claimedDays);
}
