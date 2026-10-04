"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { Guardian } from "@/hooks/useGuardians";
import { maxTribute, type Protocol } from "@/hooks/useProtocol";
import { fmtToken, plural } from "@/lib/format";
import { ClaimIcon } from "./icons";

type Filter = "all" | "idle" | "locked" | "due";

interface Props {
  locked: Guardian[];
  idle: Guardian[];
  totalPending: bigint;
  /** Unclaimed days summed across all locked guardians. */
  owedDays: number;
  now: number;
  isLoading: boolean;
  protocol: Protocol;
  busy: boolean;
  claiming: boolean;
  onClaimAll: (from: HTMLElement) => void;
  renderCard: (g: Guardian, index: number) => ReactNode;
}

/**
 * Every guardian the wallet holds in one grid. Cards that want a decision lead (finished locks to renew,
 * then idle guardians to lock); running locks settle at the end, where they can be left alone.
 */
export function Roster({ locked, idle, totalPending, owedDays, now, isLoading, protocol: p, busy, claiming, onClaimAll, renderCard }: Props) {
  const [picked, setPicked] = useState<Filter>("all");
  const due = locked.filter((g) => (g.pending ?? 0n) > 0n);
  // A filter that emptied out (e.g. after claiming everything) falls back to the full roster.
  const filter: Filter = (picked === "due" && due.length === 0) || (picked === "idle" && idle.length === 0) ? "all" : picked;

  const total = locked.length + idle.length;
  const done = locked.filter((g) => g.lock && now >= g.lock.end);
  const running = locked.filter((g) => !done.includes(g));
  // What the idle guardians could earn if every one were locked at its tier's top level.
  const idleUpside = idle.reduce((sum, g) => sum + (maxTribute(p.tiers?.[g.tier], p.durationDays) ?? 0n), 0n);

  const tabs: { id: Filter; label: string; count: number; hidden?: boolean }[] = [
    { id: "all", label: "All", count: total },
    { id: "idle", label: "Idle", count: idle.length, hidden: idle.length === 0 },
    { id: "locked", label: "Locked", count: locked.length },
    { id: "due", label: "Tribute due", count: due.length, hidden: due.length === 0 },
  ];

  const shown =
    filter === "idle"
      ? idle
      : filter === "locked"
        ? [...done, ...running]
        : filter === "due"
          ? due
          : [...done, ...idle, ...running];

  return (
    <section className="section roster">
      <div className="section-head roster-head">
        <div>
          <span className="kicker">◆ Your guardians</span>
          <h2>
            The Roster <span className="count">{isLoading ? "…" : total}</span>
          </h2>
          <p className="lore">
            {isLoading || total === 0 ? (
              "Locked guardians earn tribute every day, on their own."
            ) : idle.length > 0 ? (
              <>
                {plural(idle.length, "guardian")} {idle.length === 1 ? "is" : "are"} idle.{" "}
                {idleUpside > 0n && (
                  <b className="roster-upside">
                    Lock {idle.length === 1 ? "it" : "them"} to earn up to {fmtToken(idleUpside, p.decimals, 0)} {p.symbol}.
                  </b>
                )}
              </>
            ) : (
              "Every guardian is locked and earning. Nothing to do but claim."
            )}
          </p>
        </div>
        {!isLoading && total > 0 && (
          <dl className="roster-tally">
            <div className="roster-tally-locked">
              <dt>Locked</dt>
              <dd className="num">
                {locked.length}
                <small>/ {total}</small>
              </dd>
              <dd className="roster-meter" aria-hidden>
                {Array.from({ length: Math.min(total, 12) }, (_, i) => (
                  <i key={i} className={i < Math.round((locked.length / total) * Math.min(total, 12)) ? "on" : ""} />
                ))}
              </dd>
            </div>
            <div className="roster-tally-gold">
              <dt>Tribute due</dt>
              <dd className="num">
                {fmtToken(totalPending, p.decimals)}
                <small>{p.symbol}</small>
              </dd>
              {owedDays > 0 && <dd className="roster-tally-sub">{plural(owedDays, "day")} unclaimed</dd>}
            </div>
          </dl>
        )}
      </div>

      {!isLoading && total > 0 && (
        <div className="roster-bar">
          <div className="roster-tabs" role="tablist" aria-label="Filter guardians">
            {tabs
              .filter((t) => !t.hidden)
              .map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={filter === t.id}
                  className={`roster-tab${t.id === "due" ? " roster-tab-due" : ""}`}
                  onClick={() => setPicked(t.id)}
                >
                  {t.label}
                  <span className="num">{t.count}</span>
                </button>
              ))}
          </div>
          {due.length > 0 && (
            <button className="gbtn gbtn-gold gbtn-sm" disabled={busy} onClick={(e) => onClaimAll(e.currentTarget)}>
              {claiming ? <span className="spinner" /> : <ClaimIcon />}
              {owedDays ? `Claim ${plural(owedDays, "day")}` : "Claim all"} · {fmtToken(totalPending, p.decimals)} {p.symbol}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <Skeletons />
      ) : total === 0 ? (
        <div className="empty plate">
          <span className="kicker">◆ An empty hall</span>
          <p className="lore">No guardians in this wallet yet.</p>
          <a className="btn btn-ghost" href="https://opensea.io/collection/vyranfts/overview" target="_blank" rel="noreferrer">
            Find a guardian ↗
          </a>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty plate">
          <p className="lore">
            {filter === "locked" ? "No guardian is locked yet. Lock one to start earning." : "Every guardian is already locked."}
          </p>
          <button className="btn btn-ghost" onClick={() => setPicked("all")}>
            Show all guardians
          </button>
        </div>
      ) : (
        <div className="grid" key={filter}>
          {shown.map((g, i) => (
            <Fragment key={g.id.toString()}>{renderCard(g, i)}</Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

function Skeletons() {
  return (
    <div className="grid">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="plate skeleton" style={{ aspectRatio: "0.72", ["--chamfer" as string]: "16px" }} />
      ))}
    </div>
  );
}
