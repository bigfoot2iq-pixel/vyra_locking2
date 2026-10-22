"use client";

import type { Address } from "viem";
import { dailyPayout, lockTribute, topLevel, type Protocol } from "@/hooks/useProtocol";
import { contractUrl, useVerified } from "@/hooks/useVerified";
import { addresses } from "@/lib/env";
import { bpsToPct, fmtToken, shortAddr } from "@/lib/format";
import { CountUp } from "./fx/CountUp";

const PROMISES = [
  {
    title: "Everything you lock comes back",
    body: "The amount you lock goes into the reward pool. Each full day of the lock pays an equal share of it back plus your rarity's rate on it.",
  },
  {
    title: "A level fee buys the level for good",
    body: "Paying for a level unlocks it for that guardian, not for one lock. It stays unlocked through every later lock, and it stays in the pool.",
  },
  {
    title: "Your payout is set aside first",
    body: "A lock only opens if the pool can already pay everything back with its full profit. That amount is reserved for you as soon as you lock.",
  },
  {
    title: "Nobody can touch what you're owed",
    body: "The owner can only withdraw what isn't reserved for running locks. What is promised to you can only go to you.",
  },
  {
    title: "Claim and unlock always work",
    body: "A pause only stops new locks. Claiming payouts and taking your guardian home can never be switched off.",
  },
  {
    title: "Emergency returns go only to you",
    body: "If the Keep ever closes early, your guardian and the full payout for the period go back to the wallet that locked it.",
  },
];

/** The plain-language promise behind a lock, the live numbers that back it, and the contracts to check it against. */
export function Trust({ protocol: p }: { protocol: Protocol }) {
  const verified = useVerified([addresses.locking, addresses.pool, addresses.nft, p.token]);
  const contracts: { name: string; role: string; address: Address | undefined }[] = [
    { name: "The Keep", role: "Holds guardians while they're locked", address: addresses.locking },
    { name: "Reward pool", role: "Receives every payment and pays tribute", address: addresses.pool },
    { name: "VYRA guardians", role: "The NFT collection", address: addresses.nft },
    { name: p.token ? p.symbol : "Token", role: "What you pay in and earn", address: p.token },
  ];

  // A worked example from the live table: the most common guardian at its top level, fee included.
  const cfg = p.tiers?.[0];
  const top = topLevel(cfg);
  const exLv = cfg && top >= 0 ? cfg.levels[top] : undefined;
  const exPaid = exLv ? exLv.maxAmount + exLv.price : undefined;
  const exDays = p.durationDays ?? 0;
  const exDaily = exLv && cfg ? dailyPayout(exLv.maxAmount, cfg.dailyRateBps, exDays) : undefined;
  const exTribute = exLv && cfg ? lockTribute(exLv.maxAmount, cfg.dailyRateBps, exDays) : undefined;

  return (
    <section className="section" id="trust">
      <div className="section-head">
        <div>
          <span className="kicker">◆ How payouts work</span>
          <h2>All you pay comes back, with profit</h2>
        </div>
      </div>

      <div className="trust plate">
        <p className="trust-lead">
          The amount you lock for a period goes to the reward pool. Every full day of the lock pays you an equal share of it
          back plus your rarity&apos;s daily rate on it, so by the last day you have all of it back with profit on top, and
          your guardian comes home. A level fee buys the level for that guardian and stays in the pool.
        </p>

        {exLv && exPaid !== undefined && exDaily !== undefined && exTribute !== undefined && cfg && exPaid > 0n && (
          <ol className="trust-flow num" aria-label="Example lock">
            <li>
              <span className="trust-flow-k">You pay</span>
              <span className="trust-flow-v">
                {fmtToken(exPaid, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">
                Common guardian, Level {top + 1}: {fmtToken(exLv.maxAmount, p.decimals, 2)}
                {exLv.price > 0n ? ` + ${fmtToken(exLv.price, p.decimals, 2)} fee` : ", no fee"}
              </span>
            </li>
            <li>
              <span className="trust-flow-k">Every day</span>
              <span className="trust-flow-v is-gold">
                +{fmtToken(exDaily, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">
                a {p.durationDays}th of what you locked back + {bpsToPct(cfg.dailyRateBps)} of it, claim any time
              </span>
            </li>
            <li>
              <span className="trust-flow-k">Over {p.durationDays} days</span>
              <span className="trust-flow-v is-ok">
                {fmtToken(exLv.maxAmount + exTribute, p.decimals, 2)} <small>{p.symbol}</small>
              </span>
              <span className="trust-flow-s">
                your {fmtToken(exLv.maxAmount, p.decimals, 2)} back + {fmtToken(exTribute, p.decimals, 2)} profit (
                {bpsToPct(cfg.dailyRateBps * Number(p.durationDays ?? 0))}), and your guardian
              </span>
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
              <dt>Paid in by holders</dt>
              <dd>
                <CountUp
                  value={
                    p.totalLockPayments === undefined || p.totalLevelPayments === undefined
                      ? undefined
                      : p.totalLockPayments + p.totalLevelPayments
                  }
                  decimals={p.decimals}
                  maxFrac={0}
                />{" "}
                <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Amounts and level fees, kept by the pool</dd>
            </div>
            <div>
              <dt>Owed to holders</dt>
              <dd>
                <CountUp value={p.totalReserved} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Promised to running locks</dd>
            </div>
            <div>
              <dt>Reward pool</dt>
              <dd>
                <CountUp value={p.poolBalance} decimals={p.decimals} maxFrac={0} /> <small>{p.symbol}</small>
              </dd>
              <dd className="trust-ledger-note">Everything that pays tribute</dd>
            </div>
            <div>
              <dt>Paid to holders</dt>
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
            The code on the explorer is the code that runs. Open the pool and read <code>maxReward</code> to see the payout
            (the amount back, plus tribute on it), and <code>reserve</code> to see it set aside. Not yet independently audited.
          </p>
        </div>
      </div>
    </section>
  );
}
