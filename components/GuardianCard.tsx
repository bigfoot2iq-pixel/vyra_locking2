"use client";

import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { lockDaily, lockEarnedThrough, lockTotal as lockPayoutOf, unclaimedDays, type Guardian } from "@/hooks/useGuardians";
import { bestLock, topLevel, type Protocol } from "@/hooks/useProtocol";
import { buyUrlFor } from "@/lib/env";
import { bpsToPct, DAY, fmtClock, fmtDuration, fmtToken, plural, usdOf } from "@/lib/format";
import { tierOf } from "@/lib/tiers";
import { GuardianArt } from "./GuardianArt";
import { ClaimIcon, LevelUpIcon, LockIcon, RenewIcon, UnlockIcon } from "./icons";
import { LevelPip } from "./LevelPip";
import { TierBadge, tierStyle } from "./TierBadge";

interface Props {
  guardian: Guardian;
  protocol: Protocol;
  now: number;
  index: number;
  busy: boolean;
  /** USD per whole token, when known. */
  usd?: number;
  /** Just locked: play the seal stamp once the card shows as locked. */
  fresh?: boolean;
  onLock: () => void;
  onRenew: () => void;
  onLevelUp: () => void;
  onClaim: (from: HTMLElement) => void;
  onUnlock: () => void;
}

export function GuardianCard({ guardian: g, protocol: p, now, index, busy, usd, fresh, onLock, onRenew, onLevelUp, onClaim, onUnlock }: Props) {
  const l = g.lock;
  const cfg = p.tiers?.[g.tier];
  const top = topLevel(cfg);
  const first = cfg?.levels[0];
  const last = top >= 0 ? cfg?.levels[top] : undefined;
  const ended = !!l && now >= l.end;
  const tierClosed = !first || first.maxAmount === 0n;
  const best = bestLock(cfg, p.durationDays);
  // Can't cover even a level 1 lock (which has no fee): point straight at where to buy.
  const buyUrl = !l && !tierClosed && p.balance !== undefined && p.balance < first.minAmount ? buyUrlFor(p.token) : undefined;
  const owedDays = unclaimedDays(g, now);
  // Running-lock facts: today's day number, and what the lock paid out so far against its whole payout
  // (the payment back plus tribute).
  const daily = l ? lockDaily(l) : 0n;
  const paidIn = l ? l.amount + l.fee : 0n;
  const daysDone = l ? Math.min(Math.max(0, Math.floor((now - l.start) / DAY)), l.durationDays) : 0;
  const dayNow = l ? Math.min(daysDone + 1, l.durationDays) : 0;
  const earned = l ? lockEarnedThrough(l, daysDone) : 0n;
  const lockTotal = l ? lockPayoutOf(l) : 0n;
  // a lock paid in a token the Keep has since switched away from can't level up; it renews instead
  const oldToken = !!l && !!p.token && l.token.toLowerCase() !== p.token.toLowerCase();
  const canLevelUp = !!l && !ended && !p.paused && !oldToken && l.level < topLevel(p.tiers?.[l.tier]);

  return (
    <article
      className={`card plate tier-${g.tier} ${!l ? "card-idle" : ended ? "card-done" : "card-locked"}${fresh ? " card-fresh" : ""}`}
      style={{ ...tierStyle(g.tier), "--plate-edge": tierOf(g.tier).color, "--i": index } as CSSProperties}
      onPointerMove={sheen}
    >
      <div className="card-art">
        <GuardianArt tokenId={g.id} />
        <TierBadge tier={g.tier} />
        {!l ? (
          <span className="card-seal" role="img" aria-label="Available to lock" title="Available to lock">
            <UnlockIcon />
          </span>
        ) : ended ? (
          <span className="card-status card-status-done">Lock complete</span>
        ) : (
          <span className="card-seal" role="img" aria-label="Locked" title="Locked">
            <LockIcon />
          </span>
        )}
        <span className="card-id">#{g.id.toString().padStart(4, "0")}</span>
      </div>

      <div className="card-body">
        {l ? (
          <>
            <div className="card-row">
              <span className="dim">{ended ? "Paid back this lock" : "Paying you"}</span>
              <span className="card-row-end">
                <span
                  className="num"
                  title={`Your ${fmtToken(paidIn, p.decimals)} ${p.symbol} back plus ${bpsToPct(l.rateBps)} a day on it, spread over ${plural(l.durationDays, "day")}`}
                >
                  {ended
                    ? `${fmtToken(lockTotal, p.decimals)} ${p.symbol}`
                    : `+${fmtToken(daily, p.decimals)} ${p.symbol}/day`}
                </span>
                <LevelPip level={l.level} label={false} />
              </span>
            </div>
            {!ended && (
              <dl className="card-facts num">
                <div title="Amount + level fee paid into the pool; all of it comes back, with tribute on top">
                  <dt>Paid in</dt>
                  <dd>
                    {fmtToken(paidIn, p.decimals)}
                    <small>{p.symbol}</small>
                  </dd>
                </div>
                <div>
                  <dt>Day</dt>
                  <dd>
                    {dayNow}
                    <small>/ {l.durationDays}</small>
                  </dd>
                </div>
                <div className="is-tier">
                  <dt>Paid back</dt>
                  <dd title={`${fmtToken(earned, p.decimals)} of ${fmtToken(lockTotal, p.decimals)} ${p.symbol} this lock`}>
                    {fmtToken(earned, p.decimals, 2)}
                    <small>/ {fmtToken(lockTotal, p.decimals, 0)}</small>
                  </dd>
                  <dd className="card-facts-meter" aria-hidden>
                    <span style={{ width: `${lockTotal > 0n ? Number((earned * 1000n) / lockTotal) / 10 : 0}%` }} />
                  </dd>
                </div>
                <div>
                  <dt>Unlocks</dt>
                  <dd title={new Date(l.end * 1000).toLocaleString()}>
                    {new Date(l.end * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </dd>
                </div>
              </dl>
            )}
            {ended && (
              <div className="card-row">
                <span className="dim">Ready to claim</span>
                <span className="num claimable">
                  {fmtToken(g.pending, p.decimals)} {p.symbol}
                  {!!owedDays && (
                    <span className="due-days" title={`${plural(owedDays, "day")} waiting to be claimed`}>
                      {plural(owedDays, "day")}
                    </span>
                  )}
                </span>
              </div>
            )}
            {ended ? (
              <div className="card-actions">
                {!!g.pending && g.pending > 0n && (
                  <button className="gbtn gbtn-gloss gbtn-tier gbtn-sm" disabled={busy} onClick={(e) => onClaim(e.currentTarget)}>
                    <ClaimIcon /> Claim
                  </button>
                )}
                <button className="gbtn gbtn-gloss gbtn-tier gbtn-sm" disabled={busy || p.paused} onClick={onRenew}>
                  <RenewIcon /> Renew
                </button>
                <button
                  className="gbtn gbtn-stone gbtn-sm"
                  disabled={busy}
                  onClick={onUnlock}
                  title={
                    g.pending && g.pending > 0n
                      ? `Take your guardian and ${fmtToken(g.pending, p.decimals)} ${p.symbol} home`
                      : "Take your guardian home"
                  }
                >
                  <UnlockIcon /> Unlock
                </button>
              </div>
            ) : (
              <div className="card-actions card-actions-bar">
                <ClaimBar
                  progress={(now - l.start) / (l.end - l.start)}
                  ready={!!g.pending && g.pending > 0n}
                  disabled={busy}
                  onClaim={onClaim}
                  title={owedDays ? `Claim ${plural(owedDays, "day")} of payouts` : "A payout builds up every day"}
                  label={
                    g.pending && g.pending > 0n ? (
                      <>
                        <ClaimIcon /> Claim {fmtToken(g.pending, p.decimals)}
                      </>
                    ) : (
                      <>Next in {fmtClock(l.start + (Math.floor((now - l.start) / DAY) + 1) * DAY - now)}</>
                    )
                  }
                  meta={`${fmtDuration(l.end - now)} left`}
                />
                {canLevelUp && (
                  <button
                    className="gbtn gbtn-gloss gbtn-tier gbtn-sm card-levelup"
                    disabled={busy}
                    onClick={onLevelUp}
                    title="Level up: pay in more, earn more"
                    aria-label="Level up"
                  >
                    <LevelUpIcon />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {tierClosed || best === undefined ? (
              <p className="card-pitch card-pitch-closed lore">Locking is closed for this tier for now.</p>
            ) : (
              <div
                className="card-pitch"
                title={`Level ${best.level + 1}: pay ${fmtToken(best.paid, p.decimals)} ${p.symbol}, get ${fmtToken(best.payout, p.decimals)} ${p.symbol} back over ${plural(Number(p.durationDays), "day")}`}
              >
                <span className="card-pitch-kicker">Get up to</span>
                <span className="card-pitch-value num">
                  {fmtToken(best.daily, p.decimals, 2)} <small>{p.symbol} / day</small>
                </span>
                <span className="card-pitch-sub">
                  {usd !== undefined && <b className="card-pitch-usd">{usdOf(best.daily, p.decimals, usd)}/day · </b>}
                  Your payment back + {fmtToken(best.tribute, p.decimals, 1)} {p.symbol} profit · {p.durationDays} days
                </span>
              </div>
            )}
            <div className="card-row">
              <span className="dim">Lock range</span>
              <span className="num">
                {tierClosed || !last ? "—" : `${fmtToken(first.minAmount, p.decimals)}–${fmtToken(last.maxAmount, p.decimals)} ${p.symbol}`}
              </span>
            </div>
            <div className={`card-actions${buyUrl ? " card-actions-row" : ""}`}>
              <button className="gbtn gbtn-gloss gbtn-tier" disabled={busy || p.paused || tierClosed} onClick={onLock}>
                <LockIcon /> Lock &amp; earn
              </button>
              {buyUrl && (
                <a className="gbtn gbtn-stone" href={buyUrl} target="_blank" rel="noreferrer" title={`Buy ${p.symbol} on Sentry`}>
                  Buy {p.symbol} ↗
                </a>
              )}
            </div>
            {buyUrl && (
              <p className="card-buy-note">
                Level 1 needs {fmtToken(first?.minAmount, p.decimals)} {p.symbol}. You have {fmtToken(p.balance, p.decimals)}.
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/**
 * The claim button doubles as the lock's timeline: the filled part is time served, the dark part time left.
 * The label is drawn twice (light on the track, dark on the fill) and the fill clips it, so text stays crisp
 * wherever the edge falls.
 */
function ClaimBar({
  progress,
  ready,
  disabled,
  onClaim,
  title,
  label,
  meta,
}: {
  progress: number;
  ready: boolean;
  disabled: boolean;
  onClaim: (from: HTMLElement) => void;
  title: string;
  label: ReactNode;
  meta: string;
}) {
  const pct = `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`;
  const content = (
    <>
      <span className="claimbar-label">{label}</span>
      <span className="claimbar-meta num">{meta}</span>
    </>
  );
  return (
    <button
      className={`claimbar${ready ? " is-ready" : ""}`}
      style={{ "--p": pct } as CSSProperties}
      disabled={disabled || !ready}
      onClick={(e) => onClaim(e.currentTarget)}
      title={title}
      aria-label={`${ready ? "Claim payout" : "Nothing to claim yet"}, lock ${pct} complete`}
    >
      <span className="claimbar-track">{content}</span>
      <span className="claimbar-fill" aria-hidden>
        {content}
      </span>
    </button>
  );
}

/** Moves the holographic sheen with the cursor (CSS variables only; the card itself stays still). */
function sheen(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}
