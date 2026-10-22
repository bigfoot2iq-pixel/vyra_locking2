"use client";

import { useState, type CSSProperties } from "react";
import { bestLock, dailyPayout, topLevel, type Protocol } from "@/hooks/useProtocol";
import { bpsToPct, fmtToken, usdOf } from "@/lib/format";
import { TIERS } from "@/lib/tiers";
import { tierStyle } from "./TierBadge";
import { WalletButton } from "./WalletButton";

/** Before a wallet is connected: pick a rarity, see what one guardian of it earns. */
export function EarnPreview({ protocol: p, usd }: { protocol: Protocol; usd: number | undefined }) {
  const [tier, setTier] = useState(4);
  const cfg = p.tiers?.[tier];
  const first = cfg?.levels[0];
  const days = BigInt(p.durationDays ?? 0);
  // what each lock pays a day: the amount back plus the rate on it, spread over the days
  const free = first && cfg ? dailyPayout(first.maxAmount, cfg.dailyRateBps, days) : undefined;
  const best = bestLock(cfg, p.durationDays)?.daily;
  const top = topLevel(cfg);

  return (
    <div className="preview plate" style={tierStyle(tier) as CSSProperties}>
      <span className="kicker">◆ What could your guardian earn?</span>
      <div className="preview-tiers" role="radiogroup" aria-label="Rarity">
        {TIERS.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={tier === t.id}
            className="preview-tier"
            style={tierStyle(t.id) as CSSProperties}
            onClick={() => setTier(t.id)}
          >
            <i />
            {t.name}
          </button>
        ))}
      </div>

      {top < 0 || best === undefined ? (
        <p className="lore">Locking is closed for this rarity right now.</p>
      ) : (
        <div className="preview-out">
          <div>
            <span className="card-pitch-kicker">Level 1 · no fee</span>
            <span className="preview-value num">
              {fmtToken(free, p.decimals, 2)} <small>{p.symbol} / day</small>
            </span>
            <span className="faint">{usdOf(free, p.decimals, usd)}</span>
          </div>
          <div className="preview-best">
            <span className="card-pitch-kicker">Up to · Level {top + 1}</span>
            <span className="preview-value num">
              {fmtToken(best, p.decimals, 2)} <small>{p.symbol} / day</small>
            </span>
            <span className="faint">{usdOf(best, p.decimals, usd)}</span>
          </div>
        </div>
      )}
      <p className="dim preview-note">
        Over {p.durationDays ?? "—"} days you get everything you lock back, plus{" "}
        {cfg ? bpsToPct(cfg.dailyRateBps) : "—"} of it a day
        {cfg && p.durationDays ? `: +${bpsToPct(cfg.dailyRateBps * Number(p.durationDays))} profit per lock` : ""}. Paid out daily,
        claim whenever you like.
      </p>
      <WalletButton label="Connect to lock yours" />
    </div>
  );
}
