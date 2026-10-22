import type { Protocol } from "@/hooks/useProtocol";
import { fmtToken, usdOf } from "@/lib/format";

/**
 * What a lock costs and what it pays, in the same words everywhere: the amount goes to the pool and
 * comes back over the lock, plus the tier's daily rate on it. The level fee buys the level and
 * stays in the pool: it is not paid back.
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
  /** Paid out each day: the amount back plus tribute, spread over the days. */
  daily: bigint;
  /** Profit over the whole lock, on top of the amount that comes back. */
  tribute: bigint;
  /** e.g. "7 days". */
  tributeLabel: string;
  usd?: number;
  accent?: string;
}) {
  const sym = p.symbol;
  const pay = locked + fees;
  const back = locked + tribute;
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
          {fmtToken(pay, p.decimals)} {sym}
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
        <span>+{fmtToken(tribute, p.decimals)} {sym}</span>
      </div>
    </div>
  );
}
