"use client";

import type { CSSProperties, PointerEvent } from "react";
import { unclaimedDays, type Guardian } from "@/hooks/useGuardians";
import { maxTribute, topLevel, type Protocol } from "@/hooks/useProtocol";
import { buyUrlFor } from "@/lib/env";
import { bpsToPct, DAY, fmtDuration, fmtToken, plural, usdOf } from "@/lib/format";
import { tierOf } from "@/lib/tiers";
import { GuardianArt } from "./GuardianArt";
import { ClaimIcon, LevelUpIcon, LockIcon, RenewIcon, UnlockIcon } from "./icons";
import { LevelPip } from "./LevelPip";
import { TierBadge, tierStyle } from "./TierBadge";
import { VigilTrack } from "./VigilTrack";

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
  const earnUpTo = maxTribute(cfg, p.durationDays);
  // Can't cover even a level 1 lock (which has no fee): point straight at where to buy.
  const buyUrl = !l && !tierClosed && p.balance !== undefined && p.balance < first.minAmount ? buyUrlFor(p.token) : undefined;
  const owedDays = unclaimedDays(g, now);
  const canLevelUp = !!l && !ended && !p.paused && l.level < topLevel(p.tiers?.[l.tier]);

  return (
    <article
      className={`card plate tier-${g.tier} ${!l ? "card-idle" : ended ? "card-done" : "card-locked"}${fresh ? " card-fresh" : ""}`}
      style={{ ...tierStyle(g.tier), "--plate-edge": tierOf(g.tier).color, "--i": index } as CSSProperties}
      onPointerMove={sheen}
    >
      <div className="card-art">
        <GuardianArt tokenId={g.id} />
        <TierBadge tier={g.tier} />
        <span className={`card-status card-status-${!l ? "idle" : ended ? "done" : "locked"}`}>
          {!l ? (
            "Idle"
          ) : ended ? (
            "Lock complete"
          ) : (
            <>
              <LockIcon /> Locked
            </>
          )}
        </span>
        <span className="card-id">#{g.id.toString().padStart(4, "0")}</span>
        {l && !ended && (
          <span className="card-seal" aria-hidden>
            <LockIcon />
          </span>
        )}
      </div>

      <div className="card-body">
        {l ? (
          <>
            <div className="card-row">
              <VigilTrack lock={l} claimedDays={g.claimedDays} now={now} />
              <LevelPip level={l.level} />
            </div>
            <div className="card-row">
              <span className="dim">
                {ended ? "Lock complete" : `Day ${Math.min(Math.floor((now - l.start) / DAY) + 1, l.durationDays)} of ${l.durationDays}`}
              </span>
              <span className="num faint">{ended ? "—" : `ends in ${fmtDuration(l.end - now)}`}</span>
            </div>
            <div className="card-row">
              <span className="dim">{ended ? "Locked" : "Earning"}</span>
              <span className="num" title={`${fmtToken(l.amount, p.decimals)} ${p.symbol} locked at ${bpsToPct(l.rateBps)}/day`}>
                {ended
                  ? `${fmtToken(l.amount, p.decimals)} ${p.symbol}`
                  : `+${fmtToken((l.amount * BigInt(l.rateBps)) / 10_000n, p.decimals)} ${p.symbol}/day`}
              </span>
            </div>
            <div className="card-row">
              <span className="dim">Tribute due</span>
              <span className="num claimable">
                {fmtToken(g.pending, p.decimals)} {p.symbol}
                {!!owedDays && (
                  <span className="due-days" title={`${plural(owedDays, "day")} of tribute waiting to be claimed`}>
                    {plural(owedDays, "day")}
                  </span>
                )}
              </span>
            </div>
            <div className={`card-actions${ended ? "" : " card-actions-row"}`}>
              {!!g.pending && g.pending > 0n && (
                <button
                  className="gbtn gbtn-gold gbtn-sm"
                  disabled={busy}
                  onClick={(e) => onClaim(e.currentTarget)}
                  title={owedDays ? `Claim ${plural(owedDays, "day")} of tribute` : undefined}
                >
                  <ClaimIcon /> Claim
                  {!!owedDays && (
                    <span className="gbtn-count num" aria-label={plural(owedDays, "day")}>
                      {owedDays}d
                    </span>
                  )}
                </button>
              )}
              {canLevelUp && (
                <button className="gbtn gbtn-up gbtn-sm" disabled={busy} onClick={onLevelUp} title="Raise this lock's level and lock more">
                  <LevelUpIcon /> Level up
                </button>
              )}
              {ended && (
                <>
                  <button className="gbtn gbtn-lock gbtn-sm" disabled={busy || p.paused} onClick={onRenew}>
                    <RenewIcon /> Renew
                  </button>
                  <button className="gbtn gbtn-stone gbtn-sm" disabled={busy} onClick={onUnlock}>
                    <UnlockIcon /> Unlock
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {tierClosed || earnUpTo === undefined ? (
              <p className="card-pitch card-pitch-closed lore">Locking is closed for this tier for now.</p>
            ) : (
              <div className="card-pitch">
                <span className="card-pitch-kicker">Earn up to</span>
                <span className="card-pitch-value num">
                  {fmtToken(earnUpTo, p.decimals, 0)} <small>{p.symbol}</small>
                </span>
                <span className="card-pitch-sub">
                  {usd !== undefined && <b className="card-pitch-usd">{usdOf(earnUpTo, p.decimals, usd)} · </b>}
                  {bpsToPct(cfg!.dailyRateBps)} a day for {p.durationDays} days
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
              <button className="gbtn gbtn-treasure" disabled={busy || p.paused || tierClosed} onClick={onLock}>
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

/** Moves the holographic sheen with the cursor (CSS variables only; the card itself stays still). */
function sheen(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}
