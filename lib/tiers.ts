export type TierId = 0 | 1 | 2 | 3 | 4;

export interface TierMeta {
  id: TierId;
  name: string;
  material: string;
  color: string;
  glow: string;
}

// Matches the collection's "Rarity" trait. Each tier borrows a material from the VYRA reforges.
export const TIERS: readonly TierMeta[] = [
  { id: 0, name: "Common", material: "Gunmetal", color: "#a3a9b8", glow: "rgba(163,169,184,.45)" },
  { id: 1, name: "Uncommon", material: "Geode", color: "#7fd8a6", glow: "rgba(127,216,166,.45)" },
  { id: 2, name: "Rare", material: "Argent", color: "#8cc4ff", glow: "rgba(140,196,255,.5)" },
  { id: 3, name: "Epic", material: "Hexbloom", color: "#b690ff", glow: "rgba(182,144,255,.55)" },
  { id: 4, name: "Legendary", material: "Aurum", color: "#f2c25b", glow: "rgba(242,194,91,.55)" },
] as const;

export const tierOf = (t: number | bigint | undefined): TierMeta => TIERS[Math.min(Number(t ?? 0), TIERS.length - 1)];

const VARIANTS = [
  "runebound",
  "gunmetal",
  "hexbloom",
  "crimson",
  "crescent",
  "argent",
  "aurum",
  "obsidian",
  "geode",
] as const;

/** Placeholder art when a token has no metadata image (testnet mocks, unrevealed). */
export const fallbackArt = (tokenId: bigint) => `/vyra/${VARIANTS[Number(tokenId % 9n)]}.webp`;
