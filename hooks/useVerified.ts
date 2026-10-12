"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { explorerUrl } from "@/lib/env";

/**
 * Whether the explorer has verified source code for each address (Blockscout API).
 * `undefined` while loading or when there's no explorer (local chain).
 */
export function useVerified(list: readonly (Address | undefined)[]) {
  const addrs = list.filter((a): a is Address => !!a);
  const q = useQuery({
    queryKey: ["verified", explorerUrl, ...addrs],
    enabled: !!explorerUrl && addrs.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const out: Record<string, boolean | undefined> = {};
      await Promise.all(
        addrs.map(async (a) => {
          try {
            const r = await fetch(`${explorerUrl}/api/v2/addresses/${a}`);
            out[a.toLowerCase()] = r.ok ? Boolean((await r.json()).is_verified) : undefined;
          } catch {
            out[a.toLowerCase()] = undefined;
          }
        }),
      );
      return out;
    },
  });
  return (a: Address | undefined) => (a ? q.data?.[a.toLowerCase()] : undefined);
}

export const contractUrl = (a: Address) => (explorerUrl ? `${explorerUrl}/address/${a}?tab=contract` : undefined);
