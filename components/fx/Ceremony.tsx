"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { siteUrl } from "@/lib/env";
import { tierOf } from "@/lib/tiers";
import { tierStyle } from "../TierBadge";
import { Embers } from "./Embers";

export interface Rite {
  kind: "lock" | "renew" | "levelup";
  tokenId: bigint;
  tier: number;
  /** 0-based level (shown + 1). */
  level: number;
  image: string;
  days?: number;
}

const CeremonyCtx = createContext<(r: Rite) => void>(() => {});
/** Play the full-screen rite after a confirmed lock, renewal or level-up. */
export const useCeremony = () => useContext(CeremonyCtx);

const title = (r: Rite) =>
  r.kind === "lock" ? "Guardian Locked" : r.kind === "renew" ? "Lock Renewed" : `Level ${r.level + 1}`;

function lines(r: Rite) {
  const id = `#${r.tokenId.toString().padStart(4, "0")}`;
  const tier = tierOf(r.tier).name;
  switch (r.kind) {
    case "lock":
      return {
        lore: `Guardian ${id} stands vigil at Level ${r.level + 1} for ${r.days} days. Its first tribute comes in 24 hours.`,
        share: `My ${tier} VYRA guardian ${id} is locked in The Keep at Level ${r.level + 1}. ${r.days} days of tribute begin now. ◆`,
      };
    case "renew":
      return {
        lore: `The vigil holds. Guardian ${id} keeps watch at Level ${r.level + 1} for another ${r.days} days.`,
        share: `VYRA guardian ${id} renewed its lock at Level ${r.level + 1}. ${r.days} more days of tribute in The Keep. ◆`,
      };
    case "levelup":
      return {
        lore: `Guardian ${id} rises to Level ${r.level + 1}. Every day left now earns more.`,
        share: `My ${tier} VYRA guardian ${id} just leveled up to Level ${r.level + 1} in The Keep. ◆`,
      };
  }
}

export function CeremonyProvider({ children }: { children: ReactNode }) {
  const [rite, setRite] = useState<Rite | null>(null);
  const close = useCallback(() => setRite(null), []);

  useEffect(() => {
    if (!rite) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rite, close]);

  return (
    <CeremonyCtx.Provider value={setRite}>
      {children}
      {rite && <RiteOverlay rite={rite} onClose={close} />}
    </CeremonyCtx.Provider>
  );
}

function RiteOverlay({ rite, onClose }: { rite: Rite; onClose: () => void }) {
  const { lore, share } = lines(rite);
  const heading = title(rite);
  const url = siteUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(`${share}\n\n@VYRA______ on $INK`)}&url=${encodeURIComponent(url)}`;
  const t = tierOf(rite.tier);

  return (
    <div className="rite-overlay" role="dialog" aria-modal="true" aria-label={heading} style={tierStyle(rite.tier)}>
      <Embers density={120} goldRatio={rite.tier === 4 ? 0.6 : 0.3} className="rite-embers" />
      <div className="rite-stage">
        <div className="rite-sigil">
          <span className="rite-shock" aria-hidden />
          <svg className="rite-ring rite-ring-outer" viewBox="0 0 200 200" aria-hidden>
            <circle cx="100" cy="100" r="96" />
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} x="97" y="1" width="6" height="6" transform={`rotate(${i * 30} 100 100) rotate(45 100 4)`} />
            ))}
          </svg>
          <svg className="rite-ring rite-ring-inner" viewBox="0 0 200 200" aria-hidden>
            <circle cx="100" cy="100" r="88" strokeDasharray="2 10" />
            <circle cx="100" cy="100" r="80" strokeDasharray="40 14" opacity="0.5" />
          </svg>
          <div className="rite-portrait">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rite.image} alt="" />
          </div>
        </div>

        <span className="kicker rite-kicker" style={{ color: t.color }}>
          ◆ {t.name} · Guardian #{rite.tokenId.toString().padStart(4, "0")}
        </span>
        <h2 className="rite-title" aria-label={heading}>
          {[...heading].map((ch, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} aria-hidden>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h2>
        <p className="lore rite-lore">{lore}</p>
        <div className="rite-actions">
          <a className="btn btn-gold" href={intent} target="_blank" rel="noreferrer">
            Share on X
          </a>
          <button className="btn btn-ghost" onClick={onClose} autoFocus>
            Return to the Keep
          </button>
        </div>
      </div>
    </div>
  );
}
