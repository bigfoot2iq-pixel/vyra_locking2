import type { CSSProperties } from "react";
import { tierOf } from "@/lib/tiers";

export const tierStyle = (tier: number) => {
  const t = tierOf(tier);
  return { "--tier": t.color, "--tier-glow": t.glow } as CSSProperties;
};

export function TierBadge({ tier, className = "tier-badge" }: { tier: number; className?: string }) {
  return (
    <span className={className} style={tierStyle(tier)}>
      <i aria-hidden />
      {tierOf(tier).name}
    </span>
  );
}
