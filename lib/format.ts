import { formatUnits } from "viem";

export function fmtToken(value: bigint | undefined, decimals = 18, maxFrac = 4): string {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && n < 1 ? Math.max(maxFrac, 6) : maxFrac });
}

export function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 });
}

export const bpsToPct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** Countdown as HH:MM:SS (or Dd HH:MM when a day or more remains). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}` : `${hh}:${mm}:${ss}`;
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const DAY = 86400;

/** "1 day" / "3 days". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
