import type { Protocol } from "@/hooks/useProtocol";
import { bpsToPct, fmtToken, usdOf } from "@/lib/format";

/**
 * What a lock costs and what it pays, in the same words everywhere: the amount and the level fee
 * both go to the pool, and over the lock all of it comes back, plus the tier's daily rate on it,
 * in equal daily payouts.
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
  /** Paid out each day: the payment back plus tribute, spread over the days. */
  daily: bigint;
  /** Profit over the whole lock, on top of the payment. */
  tribute: bigint;
  /** e.g. "7 days". */
  tributeLabel: string;
  usd?: number;
  accent?: string;
}) {
  const sym = p.symbol;
  const paid = locked + fees;
  const back = paid + tribute;
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
      <div className="total">
        <span>
          You get every day
          <span className="pay-tag pay-tag-ok">your payment back + profit</span>
        </span>
        <span style={{ color: accent }}>
          +{fmtToken(daily, p.decimals)} {sym}
          {usd !== undefined && daily > 0n && <small className="faint"> {usdOf(daily, p.decimals, usd)}</small>}
        </span>
      </div>
      <div>
        <span className="dim">Back to you · {tributeLabel}</span>
        <span>
          {fmtToken(back, p.decimals)} {sym}
        </span>
      </div>
      <div className="pay-back">
        <span>Your profit</span>
        <span>
          +{fmtToken(tribute, p.decimals)} {sym}
          {totalBps > 0n && <> · +{bpsToPct(totalBps)}</>}
        </span>
      </div>
    </div>
  );
}
