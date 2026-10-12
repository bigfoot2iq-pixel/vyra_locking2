import type { Protocol } from "@/hooks/useProtocol";
import { fmtToken, usdOf } from "@/lib/format";

/**
 * What a lock costs and what comes back, in the same words everywhere: the locked amount returns at
 * unlock, only the level fee is spent, and tribute is on top.
 */
export function PayBreakdown({
  protocol: p,
  locked,
  fees,
  tribute,
  tributeLabel,
  usd,
  accent = "var(--tier)",
  lockedLabel = "You lock",
}: {
  protocol: Protocol;
  locked: bigint;
  fees: bigint;
  tribute: bigint;
  /** e.g. "0.5/day × 7 days". */
  tributeLabel: string;
  usd?: number;
  accent?: string;
  lockedLabel?: string;
}) {
  const sym = p.symbol;
  return (
    <div className="breakdown pay num">
      <div>
        <span>
          {lockedLabel}
          <span className="pay-tag pay-tag-ok">comes back at unlock</span>
        </span>
        <span>
          {fmtToken(locked, p.decimals)} {sym}
        </span>
      </div>
      <div>
        <span>
          Level fee
          {fees > 0n && <span className="pay-tag">kept by the pool</span>}
        </span>
        <span>{fees > 0n ? `${fmtToken(fees, p.decimals)} ${sym}` : "free"}</span>
      </div>
      <div className="pay-sent">
        <span className="dim">Leaves your wallet now</span>
        <span>
          {fmtToken(locked + fees, p.decimals)} {sym}
        </span>
      </div>
      <div className="total">
        <span>Tribute · {tributeLabel}</span>
        <span style={{ color: accent }}>
          +{fmtToken(tribute, p.decimals)} {sym}
          {usd !== undefined && tribute > 0n && <small className="faint"> {usdOf(tribute, p.decimals, usd)}</small>}
        </span>
      </div>
      <div className="pay-back">
        <span>Back to you at the end</span>
        <span>
          {fmtToken(locked + tribute, p.decimals)} {sym}
        </span>
      </div>
    </div>
  );
}
