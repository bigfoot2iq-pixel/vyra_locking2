"use client";

import type { Address } from "viem";
import { topLevel, type Protocol } from "@/hooks/useProtocol";
import { contractUrl, useVerified } from "@/hooks/useVerified";
import { addresses } from "@/lib/env";
import { fmtToken, shortAddr } from "@/lib/format";
import { CountUp } from "./fx/CountUp";

const PROMISES = [
  {
    title: "Your tokens come back in full",
    body: "Unlock returns every token you locked, along with your guardian and any tribute still owed. Renewing hands them back first, then takes the new amount.",
  },
  {
    title: "Nobody can touch locked tokens",
    body: "The pool keeps your locked tokens apart from its reward fund. The owner can only withdraw the free part of the fund, never what you locked.",
  },
  {
    title: "Your tribute is set aside first",
    body: "A lock only opens if the fund can already pay its full tribute. That amount is reserved for you as soon as you lock.",
  },
  {
    title: "Claim and unlock always work",
    body: "A pause only stops new locks. Claiming tribute and taking your guardian and tokens home can never be switched off.",
  },
  {
    title: "Emergency returns go only to you",
    body: "If the Keep ever closes early, your guardian, your tokens and the full tribute for the period go back to the wallet that locked them.",
  },
];

/** The plain-language promise behind a lock, the live numbers that back it, and the contracts to check it against. */
export function Trust({ protocol: p }: { protocol: Protocol }) {
  const verified = useVerified([addresses.locking, addresses.pool, addresses.nft, p.token]);
  const contracts: { name: string; role: string; address: Address | undefined }[] = [
    { name: "The Keep", role: "Holds guardians while they're locked", address: addresses.locking },
    { name: "Reward pool", role: "Holds locked tokens and pays tribute", address: addresses.pool },
    { name: "VYRA guardians", role: "The NFT collection", address: addresses.nft },
    { name: p.token ? p.symbol : "Token", role: "What you lock and earn", address: p.token },
  ];

  // A worked example from the live table: the most common guardian at its free level's cap.
  const cfg = p.tiers?.[0];
  const ex = cfg && topLevel(cfg) >= 0 ? cfg.levels[0].maxAmount : undefined;
  const exTribute = ex !== undefined && cfg ? ((ex * BigInt(cfg.dailyRateBps)) / 10_000n) * BigInt(p.durationDays ?? 0) : undefined;

  return (
    <section className="section" id="trust">
      <div className="section-head">
        <div>
          <span className="kicker">◆ Your tokens are yours</span>
          <h2>Every token you lock comes back</h2>
        </div>
      </div>

      <div className="trust plate">
        <p className="trust-lead">
          Locking is not spending. Your tokens wait in the reward pool, earning tribute every day, and come back to your
          wallet with your guardian when the lock ends. The only cost is the level fee, and Level 1 is free.
        </p>

        {ex !== undefined && exTribute !== undefined && ex > 0n && (
          <ol className="trust-flow num" aria-label="Example lock">
            <li>
              <span className="trust-flow-k">You lock</span>
              <span className="trust-flow-v">
                {fmtToken(ex, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">Common guardian, Level 1, no fee</span>
            </li>
            <li>
              <span className="trust-flow-k">You earn</span>
              <span className="trust-flow-v is-gold">
                +{fmtToken(exTribute, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">over {p.durationDays} days, claim any time</span>
            </li>
            <li>
              <span className="trust-flow-k">You get back</span>
              <span className="trust-flow-v is-ok">
                {fmtToken(ex + exTribute, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">your {fmtToken(ex, p.decimals, 2)} plus tribute, and your guardian</span>
            </li>
          </ol>
        )}

        <ul className="trust-promises">
          {PROMISES.map((x) => (
            <li key={x.title}>
              <span className="trust-check" aria-hidden>
                ✓
              </span>
              <div>
                <b>{x.title}</b>
                <p>{x.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="trust-grid">
        <div className="trust-ledger plate">
          <span className="kicker">◆ Live from the pool</span>
          <dl className="num">
            <div>
              <dt>Locked by holders</dt>
              <dd>
                <CountUp value={p.totalStaked} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Held for them, returned at unlock</dd>
            </div>
            <div>
              <dt>Tribute reserved</dt>
              <dd>
                <CountUp value={p.totalReserved} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Promised to running locks</dd>
            </div>
            <div>
              <dt>Returned to holders</dt>
              <dd>
                <CountUp value={p.totalReturned} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Locked tokens handed back</dd>
            </div>
            <div>
              <dt>Tribute paid</dt>
              <dd>
                <CountUp value={p.totalPaidOut} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Claimed by holders so far</dd>
            </div>
          </dl>
        </div>

        <div className="trust-contracts plate">
          <span className="kicker">◆ Check it yourself</span>
          <ul>
            {contracts.map((c) => {
              const ok = verified(c.address);
              const url = c.address ? contractUrl(c.address) : undefined;
              return (
                <li key={c.name}>
                  <div>
                    <b>{c.name}</b>
                    <span className="faint">{c.role}</span>
                  </div>
                  <div className="trust-contract-end">
                    {ok === true && <span className="pill pill-ok">✓ Verified source</span>}
                    {ok === false && <span className="pill pill-warn">Source not published</span>}
                    {c.address &&
                      (url ? (
                        <a className="num trust-addr" href={url} target="_blank" rel="noreferrer">
                          {shortAddr(c.address)} ↗
                        </a>
                      ) : (
                        <span className="num trust-addr">{shortAddr(c.address)}</span>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="faint trust-foot">
            The code on the explorer is the code that runs. Open a contract and read <code>unlock</code> on the Keep and{" "}
            <code>close</code> on the pool to see your tokens come back. Not yet independently audited.
          </p>
        </div>
      </div>
    </section>
  );
}
