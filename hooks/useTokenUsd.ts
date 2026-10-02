"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { ink } from "viem/chains";
import { activeChain, tokenUsdOverride } from "@/lib/env";

interface DexPair {
  priceUsd?: string;
  liquidity?: { usd?: number };
}

/**
 * USD price of one whole token, for display only (the contracts never use it).
 * Mainnet: most-liquid DexScreener pair. Testnets: NEXT_PUBLIC_TOKEN_USD_PRICE.
 */
export function useTokenUsd(token: Address | undefined): number | undefined {
  const { data } = useQuery({
    queryKey: ["tokenUsd", token],
    enabled: !!token && tokenUsdOverride === undefined && activeChain.id === ink.id,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/ink/${token}`);
      if (!res.ok) return null;
      const pairs = (await res.json()) as DexPair[];
      const best = pairs
        .filter((p) => p.priceUsd)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      return best ? Number(best.priceUsd) : null;
    },
  });
  return tokenUsdOverride ?? data ?? undefined;
}
