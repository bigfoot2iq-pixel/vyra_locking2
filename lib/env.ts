import type { Address } from "viem";
import { anvil, ink, inkSepolia } from "viem/chains";

const CHAINS = { ink, inkSepolia, anvil } as const;
export type ChainKey = keyof typeof CHAINS;

// NEXT_PUBLIC_* values must be referenced literally so Next can inline them.
const chainKey = (process.env.NEXT_PUBLIC_CHAIN ?? "inkSepolia") as ChainKey;
export const activeChain = CHAINS[chainKey] ?? inkSepolia;

const addr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

export const addresses = {
  locking: addr(process.env.NEXT_PUBLIC_LOCKING_ADDRESS),
  pool: addr(process.env.NEXT_PUBLIC_POOL_ADDRESS),
  nft: addr(process.env.NEXT_PUBLIC_NFT_ADDRESS),
};

export const isConfigured = Boolean(addresses.locking && addresses.pool && addresses.nft);

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

/** Manual USD price override (testnets have no market). */
export const tokenUsdOverride = process.env.NEXT_PUBLIC_TOKEN_USD_PRICE
  ? Number(process.env.NEXT_PUBLIC_TOKEN_USD_PRICE)
  : undefined;

/** Public URL of this app, used in share links and OG metadata. */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || undefined;

export const explorerUrl = activeChain.blockExplorers?.default.url.replace(/\/$/, "");
