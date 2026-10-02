"use client";

import type { CSSProperties, PointerEvent } from "react";
import { unclaimedDays, type Guardian } from "@/hooks/useGuardians";
import { topLevel, type Protocol } from "@/hooks/useProtocol";
import { bpsToPct, DAY, fmtClock, fmtDuration, fmtToken, plural } from "@/lib/format";
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
  onLock: () => void;
  onRenew: () => void;
  onLevelUp: () => void;
  onClaim: (from: HTMLElement) => void;
  onUnlock: () => void;
}

export function GuardianCard({ guardian: g, protocol: p, now, index, busy, onLock, onRenew, onLevelUp, onClaim, onUnlock }: Props) {
  const l = g.lock;
  const cfg = p.tiers?.[g.tier];
  const top = topLevel(cfg);
  const first = cfg?.levels[0];
  const last = top >= 0 ? cfg?.levels[top] : undefined;
  const ended = !!l && now >= l.end;
  const nextTribute = l && !ended ? l.start + (Math.floor((now - l.start) / DAY) + 1) * DAY : undefined;
  const tierClosed = !first || first.maxAmount === 0n;
  const owedDays = unclaimedDays(g, now);
  const canLevelUp = !!l && !ended && !p.paused && l.level < topLevel(p.tiers?.[l.tier]);

  return (
    <article
      className={`card plate tier-${g.tier}${l ? " card-locked" : " card-idle"}`}
      style={{ ...tierStyle(g.tier), "--plate-edge": tierOf(g.tier).color, "--i": index } as CSSProperties}
      onPointerMove={sheen}
    >
      <div className="card-art">
        <GuardianArt tokenId={g.id} />
        <TierBadge tier={g.tier} />
        <span className={`card-status card-status-${!l ? "idle" : ended ? "done" : "vigil"}`}>
          {!l ? (
            "In wallet"
          ) : ended ? (
            "Vigil complete"
          ) : (
            <>
              <span className="gem-sm gem-pulse" /> On vigil
            </>
          )}
        </span>
        <span className="card-id">#{g.id.toString().padStart(4, "0")}</span>
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
            {nextTribute !== undefined && (
              <div className="card-row">
                <span className="dim">Next tribute</span>
                <span className="num next-tribute">
                  <span className="gem-sm gem-pulse" /> {fmtClock(nextTribute - now)}
                </span>
              </div>
            )}
            <div className="card-row">
              <span className="dim">Locked</span>
              <span className="num">
                {fmtToken(l.amount, p.decimals)} {p.symbol} · {bpsToPct(l.rateBps)}/day
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
            <div className="card-row">
              <span className="dim">Levels</span>
              <LevelPip level={top} label={false} />
            </div>
            <div className="card-row">
              <span className="dim">Lock</span>
              <span className="num">
                {tierClosed || !last
                  ? "closed"
                  : `${fmtToken(first.minAmount, p.decimals)}–${fmtToken(last.maxAmount, p.decimals)} ${p.symbol}`}
              </span>
            </div>
            <div className="card-row">
              <span className="dim">Daily tribute</span>
              <span className="num">
                {cfg ? bpsToPct(cfg.dailyRateBps) : "—"} · {p.durationDays ?? "—"} days
              </span>
            </div>
            <div className="card-actions">
              <button className="gbtn gbtn-lock" disabled={busy || p.paused || tierClosed} onClick={onLock}>
                <LockIcon /> Lock guardian
              </button>
            </div>
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
