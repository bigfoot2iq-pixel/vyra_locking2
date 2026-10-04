"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { tierOf } from "@/lib/tiers";
import { tierStyle } from "./TierBadge";

export function Dialog({
  title,
  kicker,
  image,
  tier,
  onClose,
  children,
}: {
  title: string;
  kicker?: ReactNode;
  image?: string;
  /** The guardian's rarity: the dialog's edge, accents and main button take its colour. */
  tier?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog plate${tier === undefined ? "" : " dialog-tier"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={tier === undefined ? undefined : ({ ...tierStyle(tier), "--plate-edge": tierOf(tier).color } as CSSProperties)}
      >
        <div className="dialog-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image && <img src={image} alt="" />}
          <div>
            {kicker && <span className="kicker">{kicker}</span>}
            <h2>{title}</h2>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
