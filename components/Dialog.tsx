"use client";

import { useEffect, type ReactNode } from "react";

export function Dialog({
  title,
  kicker,
  image,
  onClose,
  children,
}: {
  title: string;
  kicker?: ReactNode;
  image?: string;
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
      <div className="dialog plate" role="dialog" aria-modal="true" aria-label={title}>
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
