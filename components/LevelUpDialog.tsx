"use client";

import { useState, type CSSProperties } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { lockDaily, lockEarnedThrough, lockTotal, type Guardian } from "@/hooks/useGuardians";
import { levelFeeDue, levelOpen, type Protocol } from "@/hooks/useProtocol";
import { useTokenUsd } from "@/hooks/useTokenUsd";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi } from "@/lib/abis";
import { addresses } from "@/lib/env";
import { bpsToPct, DAY, fmtToken, fmtUsd } from "@/lib/format";
import { Dialog } from "./Dialog";
import { ShortNotice } from "./ShortNotice";
import { LevelUpIcon } from "./icons";
import { useCeremony } from "./fx/Ceremony";
import { useGuardianImage } from "./GuardianArt";
import { TierBadge, tierStyle } from "./TierBadge";

const BPS = 10_000n;

function safeParse(v: string, decimals: number): bigint | undefined {
  try {
    return v.trim() === "" ? undefined : parseUnits(v.trim() as `${number}`, decimals);
  } catch {
    return undefined;
  }
}

/** Raise a running lock to a higher level: pay the level fee (unless it is already unlocked) plus a top-up. */
export function LevelUpDialog({
  guardian: g,
  protocol: p,
  now,
  onClose,
}: {
  guardian: Guardian;
  protocol: Protocol;
  now: number;
  onClose: () => void;
}) {
  const image = useGuardianImage(g.id);
  const usd = useTokenUsd(p.token);
  const { send, busy } = useTx();
  const celebrate = useCeremony();

  const l = g.lock!;
  const cfg = p.tiers?.[l.tier];
  const levels = cfg?.levels ?? [];
  // Level access belongs to the guardian: a level it already owns is free to level up to.
  const access = g.access;
  const firstUp = levels.findIndex((_, i) => i > l.level && levelOpen(cfg, access, i));

  const [level, setLevel] = useState(firstUp);
  const target = levels[level];
  // the floor of a level is 1: a level-up only raises the cap, it never lowers what is locked
  const min = l.amount;
  const max = target?.maxAmount ?? 0n;
  const [input, setInput] = useState(() => formatUnits(target?.maxAmount ?? 0n, p.decimals));

  const amount = safeParse(input, p.decimals);
  const inRange = amount !== undefined && amount >= min && amount <= max;
  const pct = max > min && amount !== undefined ? Number(((amount - min) * 1000n) / (max - min)) / 10 : 0;

  const fee = levelFeeDue(cfg, access, level);
  const a = amount ?? l.amount;
  const topUp = a > l.amount ? a - l.amount : 0n;
  const pay = fee + topUp;

  const rate = BigInt(l.rateBps);
  const elapsedDays = Math.min(Math.floor((now - l.start) / DAY), l.durationDays);
  const remaining = BigInt(l.durationDays - elapsedDays);
  // what is paid now comes back over the remaining days, with the rate on it for each of them;
  // the days earned so far are paid out first, the rest of the old payout carries on
  const extra = (topUp * rate * remaining) / BPS;
  const oldDaily = lockDaily(l);
  const left = lockTotal(l) - lockEarnedThrough(l, elapsedDays);
  const newDaily = remaining > 0n ? (left + topUp + extra) / remaining : oldDaily;

  // An approval made in this dialog counts right away, even if the RPC hasn't caught up yet.
  const [approved, setApproved] = useState(0n);
  const [step, setStep] = useState<"token" | "up" | null>(null);
  const [error, setError] = useState<string>();
  const checking = p.allowanceLocking === undefined;
  const needToken = (p.allowanceLocking ?? 0n) < pay && approved < pay;
  const short = p.balance !== undefined && p.balance < pay;
  // the payment joins the free fund first, so only the extra profit needs covering
  const poolShort = p.poolAvailable !== undefined && extra > p.poolAvailable;
  const pending = g.pending ?? 0n;
  const endDate = new Date(l.end * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  function pickLevel(i: number) {
    setLevel(i);
    setInput(formatUnits(levels[i].maxAmount, p.decimals));
  }

  /** Approves (if needed) and levels up in one click. */
  async function act() {
    if (!amount || level < 0) return;
    setError(undefined);
    const steps = needToken ? 2 : 1;
    try {
      if (needToken) {
        setStep("token");
        const ok = await send(
          `${p.symbol} approved`,
          { address: p.token!, abi: erc20Abi, functionName: "approve", args: [addresses.locking!, pay] },
          { onError: setError },
        );
        if (!ok) return;
        setApproved(pay);
      }
      setStep(steps === 2 ? "up" : null);
      const ok = await send(
        `Level ${level + 1} reached`,
        { address: addresses.locking!, abi: vyraLockingAbi, functionName: "levelUp", args: [g.id, level, amount] },
        { onError: setError },
      );
      if (ok) {
        onClose();
        celebrate({ kind: "levelup", tokenId: g.id, tier: l.tier, level, image });
      }
    } finally {
      setStep(null);
    }
  }

  const label = checking
    ? "Checking your wallet…"
    : step === "token"
      ? "Step 1 of 2 · approve in wallet"
      : step === "up"
        ? "Step 2 of 2 · confirm in wallet"
        : busy
          ? "Confirm in wallet"
          : needToken
            ? `Level up to ${level + 1} · 2 quick steps`
            : `Level up to ${level + 1}`;

  return (
    <Dialog title={`Guardian #${g.id.toString().padStart(4, "0")}`} kicker="◆ Level up" image={image} tier={l.tier} onClose={onClose}>
      <div style={tierStyle(l.tier) as CSSProperties}>
        <div className="card-row" style={{ marginBottom: 14 }}>
          <TierBadge tier={l.tier} className="tier-badge tier-badge-inline" />
          <span className="faint" style={{ fontSize: "0.8rem" }}>
            Paid in: {fmtToken(l.amount, p.decimals)} {p.symbol} at Level {l.level + 1}
          </span>
        </div>

        {firstUp === -1 ? (
          <p className="notice">This lock is already at the highest open level.</p>
        ) : (
          <>
            <div className="field">
              <span className="field-label">New level</span>
              <div className="level-picker" role="radiogroup" aria-label="Level">
                {levels.map((lv, i) => {
                  const current = i === l.level;
                  const selectable = i > l.level && levelOpen(cfg, access, i);
                  const due = levelFeeDue(cfg, access, i);
                  return (
                    <button
                      key={i}
                      role="radio"
                      aria-checked={i === level}
                      className={`level-tile${current ? " is-current" : ""}`}
                      disabled={!selectable || !!busy}
                      onClick={() => pickLevel(i)}
                    >
                      <span className="level-tile-name">Lv {i + 1}</span>
                      <span className="level-tile-cap num">{lv.maxAmount > 0n ? `≤ ${fmtToken(lv.maxAmount, p.decimals, 0)}` : "—"}</span>
                      <span className="level-tile-fee num">
                        {current ? "current" : i < l.level ? "" : selectable ? (due > 0n ? `+${fmtToken(due, p.decimals)}` : "unlocked") : "closed"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="amount">
                <span>Total amount after level up</span>
                <span className="num">
                  {fmtToken(min, p.decimals)} – {fmtToken(max, p.decimals)} {p.symbol}
                </span>
              </label>
              <input id="amount" className="input" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value.replace(",", "."))} />
              <input
                className="range"
                type="range"
                min={0}
                max={1000}
                value={Math.round(pct * 10)}
                onChange={(e) => setInput(formatUnits(min + ((max - min) * BigInt(Number(e.target.value))) / 1000n, p.decimals))}
                style={{ "--pct": `${pct}%` } as CSSProperties}
                aria-label="Total amount"
              />
            </div>

            <div className="breakdown pay num">
              <div>
                <span>Top-up</span>
                <span>{fmtToken(topUp, p.decimals)}</span>
              </div>
              <div>
                <span>Level fee</span>
                <span>{fee > 0n ? fmtToken(fee, p.decimals) : "unlocked"}</span>
              </div>
              <div className="pay-sent">
                <span className="dim">
                  You pay
                  <span className="pay-tag">goes to the pool</span>
                </span>
                <span>
                  {fmtToken(pay, p.decimals)} {p.symbol}
                  {usd !== undefined && <span className="faint"> ≈ {fmtUsd(Number(formatUnits(pay, p.decimals)) * usd)}</span>}
                </span>
              </div>
              <div className="total">
                <span>
                  You get every day · {remaining.toString()} days left
                </span>
                <span style={{ color: "var(--tier)" }}>
                  {fmtToken(oldDaily, p.decimals)} → {fmtToken(newDaily, p.decimals)} {p.symbol}
                </span>
              </div>
              {topUp > 0n && (
                <div className="pay-back">
                  <span>
                    Extra profit · what you pay now comes back with {bpsToPct(rate)} a day
                  </span>
                  <span>+{fmtToken(extra, p.decimals)} {p.symbol}</span>
                </div>
              )}
            </div>

            <p className="notice" style={{ marginBottom: 18 }}>
              <span className="gem-sm" />
              <span>
                {pending > 0n && (
                  <>
                    Your {fmtToken(pending, p.decimals)} {p.symbol} already earned is paid out now.{" "}
                  </>
                )}
                The lock still ends {endDate}.
              </span>
            </p>

            {amount !== undefined && !inRange && <p className="notice notice-danger">Amount must be within Level {level + 1}&apos;s range.</p>}
            <ShortNotice protocol={p} pay={pay} />
            {poolShort && (
              <p className="notice notice-warn">The reward pool can&apos;t back this much extra profit right now. Try a smaller top-up.</p>
            )}

            {error && <p className="notice notice-danger">{error}</p>}
            <button
              className="gbtn gbtn-gloss gbtn-tier gbtn-block gbtn-lg"
              disabled={!!busy || checking || !inRange || short || poolShort || p.paused}
              onClick={act}
            >
              {busy || checking ? <span className="spinner" /> : <LevelUpIcon />}
              {label}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
