import type { Protocol } from "@/hooks/useProtocol";
import { bpsToPct, fmtToken, usdOf } from "@/lib/format";

/**
 * What a lock costs and what it earns, in the same words everywhere: the amount and the level fee
 * both go to the pool, and every day pays the tier's rate on all of it.
 */
export function PayBreakdown({
  protocol: p,
  locked,
  fees,
  daily,
  tribute,
  tributeLabel,
  usd,
  accent = "var(--tier)",
}: {
  protocol: Protocol;
  locked: bigint;
  fees: bigint;
  /** Tribute per day on amount + fee. */
  daily: bigint;
  tribute: bigint;
  /** e.g. "7 days". */
  tributeLabel: string;
  usd?: number;
  accent?: string;
}) {
  const sym = p.symbol;
  const paid = locked + fees;
  const dailyBps = paid > 0n ? (daily * 10_000n) / paid : 0n;
  const totalBps = paid > 0n ? (tribute * 10_000n) / paid : 0n;
  return (
    <div className="breakdown pay num">
      <div>
        <span className="dim">
          You pay
          <span className="pay-tag">
            {fmtToken(locked, p.decimals)} + {fees > 0n ? `${fmtToken(fees, p.decimals)} fee` : "no fee"} · to the pool
          </span>
        </span>
        <span>
          {fmtToken(paid, p.decimals)} {sym}
        </span>
      </div>
      <div>
        <span>
          Every day
          {dailyBps > 0n && <span className="pay-tag pay-tag-ok">{bpsToPct(dailyBps)} of what you pay</span>}
        </span>
        <span style={{ color: accent }}>
          +{fmtToken(daily, p.decimals)} {sym}
        </span>
      </div>
      <div className="total">
        <span>Tribute · {tributeLabel}</span>
        <span style={{ color: accent }}>
          +{fmtToken(tribute, p.decimals)} {sym}
          {usd !== undefined && tribute > 0n && <small className="faint"> {usdOf(tribute, p.decimals, usd)}</small>}
        </span>
      </div>
      {totalBps > 0n && (
        <div className="pay-back">
          <span>Earned on what you pay</span>
          <span>+{bpsToPct(totalBps)}</span>
        </div>
      )}
    </div>
  );
}
