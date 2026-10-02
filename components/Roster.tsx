"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { Guardian } from "@/hooks/useGuardians";
import type { Protocol } from "@/hooks/useProtocol";
import { fmtToken, plural } from "@/lib/format";
import { ClaimIcon } from "./icons";

type Filter = "all" | "vigil" | "ready" | "due";

interface Props {
  locked: Guardian[];
  idle: Guardian[];
  totalPending: bigint;
  /** Unclaimed days summed across all locked guardians. */
  owedDays: number;
  isLoading: boolean;
  protocol: Protocol;
  busy: boolean;
  claiming: boolean;
  onClaimAll: (from: HTMLElement) => void;
  renderCard: (g: Guardian, index: number) => ReactNode;
}

/** Every guardian the wallet holds in one grid: those on vigil first, then the ones ready to lock. */
export function Roster({ locked, idle, totalPending, owedDays, isLoading, protocol: p, busy, claiming, onClaimAll, renderCard }: Props) {
  const [picked, setPicked] = useState<Filter>("all");
  const due = locked.filter((g) => (g.pending ?? 0n) > 0n);
  // A filter that emptied out (e.g. after claiming everything) falls back to the full roster.
  const filter: Filter = picked === "due" && due.length === 0 ? "all" : picked;

  const total = locked.length + idle.length;
  const tabs: { id: Filter; label: string; count: number; hidden?: boolean }[] = [
    { id: "all", label: "All", count: total },
    { id: "vigil", label: "On vigil", count: locked.length },
    { id: "ready", label: "Ready to lock", count: idle.length },
    { id: "due", label: "Tribute due", count: due.length, hidden: due.length === 0 },
  ];

  const top = filter === "ready" ? [] : filter === "due" ? due : locked;
  const bottom = filter === "all" || filter === "ready" ? idle : [];
  const showDivider = filter === "all" && top.length > 0 && bottom.length > 0;

  return (
    <section className="section roster">
      <div className="section-head roster-head">
        <div>
          <span className="kicker">◆ Your guardians</span>
          <h2>
            The Roster <span className="count">{isLoading ? "…" : total}</span>
          </h2>
          <p className="lore">Guardians on vigil earn tribute each day. The rest wait in your wallet, ready to lock.</p>
        </div>
        {!isLoading && total > 0 && (
          <dl className="roster-tally">
            <div>
              <dt>On vigil</dt>
              <dd className="num">
                {locked.length}
                <small>/ {total}</small>
              </dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd className="num">{idle.length}</dd>
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
      ) : top.length + bottom.length === 0 ? (
        <div className="empty plate">
          <p className="lore">
            {filter === "vigil" ? "No guardian stands vigil yet. Lock one to start earning." : "Every guardian is already on vigil."}
          </p>
          <button className="btn btn-ghost" onClick={() => setPicked("all")}>
            Show all guardians
          </button>
        </div>
      ) : (
        <div className="grid" key={filter}>
          {top.map((g, i) => (
            <Fragment key={g.id.toString()}>{renderCard(g, i)}</Fragment>
          ))}
          {showDivider && (
            <div className="roster-divider" style={{ ["--i" as string]: top.length }}>
              <span className="gem-sm" />
              <span className="roster-divider-label">Ready to lock</span>
              <span className="num faint">{bottom.length}</span>
              <span className="roster-divider-rule" />
              <span className="lore">Tribute starts the day after you lock.</span>
            </div>
          )}
          {bottom.map((g, i) => (
            <Fragment key={g.id.toString()}>{renderCard(g, top.length + i)}</Fragment>
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
