"use client";

import { useState, type CSSProperties } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import type { Guardian } from "@/hooks/useGuardians";
import type { Protocol } from "@/hooks/useProtocol";
import { useTokenUsd } from "@/hooks/useTokenUsd";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi } from "@/lib/abis";
import { addresses } from "@/lib/env";
import { bpsToPct, DAY, fmtToken, fmtUsd } from "@/lib/format";
import { Dialog } from "./Dialog";
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

/** Raise a running lock to a higher level: pay the fee difference plus a top-up. */
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
  const isOpen = (i: number) => !!levels[i] && levels[i].maxAmount > 0n && levels[i].price > 0n;
  const firstUp = levels.findIndex((_, i) => i > l.level && isOpen(i));

  const [level, setLevel] = useState(firstUp);
  const target = levels[level];
  const min = target ? (target.minAmount > l.amount ? target.minAmount : l.amount) : 0n;
  const max = target?.maxAmount ?? 0n;
  const [input, setInput] = useState(() => formatUnits(target?.maxAmount ?? 0n, p.decimals));

  const amount = safeParse(input, p.decimals);
  const inRange = amount !== undefined && amount >= min && amount <= max;
  const pct = max > min && amount !== undefined ? Number(((amount - min) * 1000n) / (max - min)) / 10 : 0;

  const feeDiff = target ? target.price - (levels[l.level]?.price ?? 0n) : 0n;
  const a = amount ?? l.amount;
  const topUp = a > l.amount ? a - l.amount : 0n;
  const pay = feeDiff + topUp;

  const rate = BigInt(l.rateBps);
  const elapsedDays = Math.min(Math.floor((now - l.start) / DAY), l.durationDays);
  const remaining = BigInt(l.durationDays - elapsedDays);
  const oldDaily = (l.amount * rate) / BPS;
  const newDaily = (a * rate) / BPS;
  const extra = (newDaily - oldDaily) * remaining;

  const needToken = (p.allowanceLocking ?? 0n) < pay;
  const short = p.balance !== undefined && p.balance < pay;
  const pending = g.pending ?? 0n;
  const endDate = new Date(l.end * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  function pickLevel(i: number) {
    setLevel(i);
    setInput(formatUnits(levels[i].maxAmount, p.decimals));
  }

  async function act() {
    if (!amount || level < 0) return;
    if (needToken) {
      await send(`${p.symbol} approved`, {
        address: p.token!,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.locking!, pay],
      });
      return;
    }
    const ok = await send(`Level ${level + 1} reached`, {
      address: addresses.locking!,
      abi: vyraLockingAbi,
      functionName: "levelUp",
      args: [g.id, level, amount],
    });
    if (ok) {
      onClose();
      celebrate({ kind: "levelup", tokenId: g.id, tier: l.tier, level, image });
    }
  }

  return (
    <Dialog title={`Guardian #${g.id.toString().padStart(4, "0")}`} kicker="◆ Level up" image={image} onClose={onClose}>
      <div style={tierStyle(l.tier) as CSSProperties}>
        <div className="card-row" style={{ marginBottom: 14 }}>
          <TierBadge tier={l.tier} className="tier-badge tier-badge-inline" />
          <span className="faint" style={{ fontSize: "0.8rem" }}>
            Locked: {fmtToken(l.amount, p.decimals)} {p.symbol} at Level {l.level + 1}
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
                  const selectable = i > l.level && isOpen(i);
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
                        {current ? "current" : i < l.level ? "" : selectable ? `+${fmtToken(lv.price - (levels[l.level]?.price ?? 0n), p.decimals)}` : "closed"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="amount">
                <span>Total locked after level up</span>
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
                aria-label="Total locked"
              />
            </div>

            <div className="breakdown num">
              <div>
                <span className="dim">Level fee difference</span>
                <span>{fmtToken(feeDiff, p.decimals)}</span>
              </div>
              <div>
                <span className="dim">Top-up</span>
                <span>{fmtToken(topUp, p.decimals)}</span>
              </div>
              <div>
                <span className="dim">You pay into the reward pool</span>
                <span>
                  {fmtToken(pay, p.decimals)} {p.symbol}
                  {usd !== undefined && <span className="faint"> ≈ {fmtUsd(Number(formatUnits(pay, p.decimals)) * usd)}</span>}
                </span>
              </div>
              <div className="total">
                <span>
                  Tribute {fmtToken(oldDaily, p.decimals)} → {fmtToken(newDaily, p.decimals)}/day ({bpsToPct(rate)}) ·{" "}
                  {remaining.toString()} days left
                </span>
                <span style={{ color: "var(--tier)" }}>
                  +{fmtToken(extra, p.decimals)} {p.symbol}
                </span>
              </div>
            </div>

            <p className="notice" style={{ marginBottom: 18 }}>
              <span className="gem-sm" />
              <span>
                {pending > 0n && (
                  <>
                    Your {fmtToken(pending, p.decimals)} {p.symbol} of earned tribute is paid out now.{" "}
                  </>
                )}
                The lock still ends {endDate}.
              </span>
            </p>

            {amount !== undefined && !inRange && <p className="notice notice-danger">Amount must be within Level {level + 1}&apos;s range.</p>}
            {short && <p className="notice notice-danger">Not enough {p.symbol} in your wallet.</p>}

            <button className="gbtn gbtn-up gbtn-block gbtn-lg" disabled={!!busy || !inRange || short || p.paused} onClick={act}>
              {busy ? <span className="spinner" /> : <LevelUpIcon />}
              {busy ?? (needToken ? `Approve ${fmtToken(pay, p.decimals)} ${p.symbol}` : `Level up to ${level + 1}`)}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
