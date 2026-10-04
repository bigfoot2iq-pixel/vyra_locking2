export type TierId = 0 | 1 | 2 | 3 | 4;

export interface TierMeta {
  id: TierId;
  name: string;
  material: string;
  color: string;
  glow: string;
}

// Matches the collection's "Rarity" trait. Each tier borrows a material from the VYRA reforges.
// Colours: OpenSea's rarity-badge palette for Common, Rare, Epic and Legendary. The trait itself carries no colour,
// and OpenSea's palette has no Uncommon, so Uncommon takes a game-standard green between Common grey and Rare blue.
export const TIERS: readonly TierMeta[] = [
  { id: 0, name: "Common", material: "Gunmetal", color: "#acadae", glow: "rgba(172,173,174,.45)" },
  { id: 1, name: "Uncommon", material: "Geode", color: "#2fd07a", glow: "rgba(47,208,122,.45)" },
  { id: 2, name: "Rare", material: "Argent", color: "#00a3ff", glow: "rgba(0,163,255,.5)" },
  { id: 3, name: "Epic", material: "Hexbloom", color: "#d358ff", glow: "rgba(211,88,255,.55)" },
  { id: 4, name: "Legendary", material: "Aurum", color: "#ff8a00", glow: "rgba(255,138,0,.55)" },
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
