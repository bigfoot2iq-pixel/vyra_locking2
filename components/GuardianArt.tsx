"use client";

import { useQuery } from "@tanstack/react-query";
import { erc721Abi } from "viem";
import { useReadContract } from "wagmi";
import { addresses } from "@/lib/env";
import { fallbackArt } from "@/lib/tiers";

const gateway = (uri: string) =>
  uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}` : uri;

async function fetchImage(tokenURI: string): Promise<string | null> {
  if (tokenURI.startsWith("data:application/json")) {
    const [, payload] = tokenURI.split(",", 2);
    const json = tokenURI.includes(";base64,") ? atob(payload) : decodeURIComponent(payload);
    return (JSON.parse(json) as { image?: string }).image ?? null;
  }
  const res = await fetch(gateway(tokenURI));
  if (!res.ok) return null;
  const meta = (await res.json()) as { image?: string };
  return meta.image ? gateway(meta.image) : null;
}

/** Resolves the token's metadata image, falling back to VYRA reforge art. */
export function useGuardianImage(tokenId: bigint): string {
  const { data: uri } = useReadContract({
    address: addresses.nft,
    abi: erc721Abi,
    functionName: "tokenURI",
    args: [tokenId],
    query: { staleTime: Infinity },
  });
  const { data: image } = useQuery({
    queryKey: ["guardianImage", uri],
    queryFn: () => fetchImage(uri!),
    enabled: !!uri,
    staleTime: Infinity,
    retry: 0,
  });
  return image ?? fallbackArt(tokenId);
}

export function GuardianArt({ tokenId }: { tokenId: bigint }) {
  const src = useGuardianImage(tokenId);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`VYRA guardian #${tokenId}`} loading="lazy" />;
}
