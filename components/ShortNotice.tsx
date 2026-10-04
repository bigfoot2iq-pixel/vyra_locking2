import type { Protocol } from "@/hooks/useProtocol";
import { buyUrlFor } from "@/lib/env";
import { fmtToken } from "@/lib/format";

/** Wallet can't cover a payment: say exactly how much is missing and where to get it. */
export function ShortNotice({ protocol: p, pay }: { protocol: Protocol; pay: bigint }) {
  if (p.balance === undefined || p.balance >= pay) return null;
  const buy = buyUrlFor(p.token);
  return (
    <p className="notice notice-danger notice-short">
      <span>
        You need <b className="num">{fmtToken(pay - p.balance, p.decimals)} {p.symbol}</b> more.
      </span>
      {buy && (
        <a className="notice-link" href={buy} target="_blank" rel="noreferrer">
          Get {p.symbol} ↗
        </a>
      )}
    </p>
  );
}
