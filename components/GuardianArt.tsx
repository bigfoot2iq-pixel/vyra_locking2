"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc721Abi } from "viem";
import { useReadContract } from "wagmi";
import { addresses } from "@/lib/env";
import imageHashes from "@/lib/guardian-images.json";
import { fallbackArt } from "@/lib/tiers";

/** The real VYRA collection on Ink. Its art is served from OpenSea's CDN (see scripts/build-image-map.mjs). */
const VYRA_NFT = "0x9045306ba97efe8b0df46817ead4fb099aae1afe";
const isVyra = addresses.nft?.toLowerCase() === VYRA_NFT;
const hashes = imageHashes as Record<string, string>;

/** One size everywhere (cards, dialogs, ceremony) so the browser fetches each guardian once. */
const openSeaArt = (tokenId: bigint) => {
  const md5 = hashes[tokenId.toString()];
  return md5 ? `https://i2c.seadn.io/ink/${VYRA_NFT}/${md5.slice(2)}/${md5}.png?w=600` : undefined;
};

// Public gateways like ipfs.io now refuse API-style requests; Pinata's still answers, if slowly.
const gateway = (uri: string) =>
  uri.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}` : uri;

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

/** OpenSea CDN art for the real collection; otherwise the token's metadata image; else VYRA reforge art. */
export function useGuardianImage(tokenId: bigint): string {
  const known = isVyra ? openSeaArt(tokenId) : undefined;
  const { data: uri } = useReadContract({
    address: addresses.nft,
    abi: erc721Abi,
    functionName: "tokenURI",
    args: [tokenId],
    query: { enabled: !known, staleTime: Infinity },
  });
  const { data: image } = useQuery({
    queryKey: ["guardianImage", uri],
    queryFn: () => fetchImage(uri!),
    enabled: !known && !!uri,
    staleTime: Infinity,
    retry: 0,
  });
  return known ?? image ?? fallbackArt(tokenId);
}

export function GuardianArt({ tokenId }: { tokenId: bigint }) {
  const src = useGuardianImage(tokenId);
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const shown = failed === src ? fallbackArt(tokenId) : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt={`VYRA guardian #${tokenId}`}
      loading="lazy"
      decoding="async"
      className={loaded === shown ? "is-loaded" : undefined}
      onLoad={() => setLoaded(shown)}
      onError={() => setFailed(src)}
    />
  );
}
