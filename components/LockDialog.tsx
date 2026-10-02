"use client";

import { useState, type CSSProperties } from "react";
import { erc20Abi, erc721Abi, formatUnits, parseUnits } from "viem";
import type { Guardian } from "@/hooks/useGuardians";
import type { Protocol } from "@/hooks/useProtocol";
import { useTokenUsd } from "@/hooks/useTokenUsd";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi } from "@/lib/abis";
import { addresses } from "@/lib/env";
import { bpsToPct, fmtToken, fmtUsd } from "@/lib/format";
import { Dialog } from "./Dialog";
import { LockIcon, RenewIcon } from "./icons";
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

export function LockDialog({
  guardian: g,
  protocol: p,
  mode,
  onClose,
}: {
  guardian: Guardian;
  protocol: Protocol;
  mode: "lock" | "renew";
  onClose: () => void;
}) {
  const image = useGuardianImage(g.id);
  const usd = useTokenUsd(p.token);
  const { send, busy } = useTx();
  const celebrate = useCeremony();

  const cfg = p.tiers?.[g.tier];
  const levels = cfg?.levels ?? [];
  const [level, setLevel] = useState(0);
  const lv = levels[level];
  const min = lv?.minAmount ?? 0n;
  const max = lv?.maxAmount ?? 0n;
  const fee = lv?.price ?? 0n;
  const [input, setInput] = useState(() => formatUnits(levels[0]?.maxAmount ?? 0n, p.decimals));

  const amount = safeParse(input, p.decimals);
  const inRange = amount !== undefined && amount >= min && amount <= max;
  const pct = max > min && amount !== undefined ? Number(((amount - min) * 1000n) / (max - min)) / 10 : 0;

  const days = BigInt(p.durationDays ?? 0);
  const rate = BigInt(cfg?.dailyRateBps ?? 0);
  const a = amount ?? 0n;
  const pay = a + fee;
  const daily = (a * rate) / BPS;
  const total = daily * days;

  const needNft = mode === "lock" && !p.nftApproved;
  const needToken = (p.allowanceLocking ?? 0n) < pay;
  const short = p.balance !== undefined && p.balance < pay;
  // the payment lands in the pool before this lock's rewards are reserved
  const poolShort = p.poolAvailable !== undefined && total > p.poolAvailable + pay;
  const unclaimed = g.pending ?? 0n;

  const usdOf = (v: bigint) => (usd !== undefined ? fmtUsd(Number(formatUnits(v, p.decimals)) * usd) : "");

  function pickLevel(i: number) {
    setLevel(i);
    setInput(formatUnits(levels[i].maxAmount, p.decimals));
  }

  function setFromSlider(permille: number) {
    setInput(formatUnits(min + ((max - min) * BigInt(permille)) / 1000n, p.decimals));
  }

  async function act() {
    if (!amount) return;
    if (needNft) {
      await send("Keep access granted", {
        address: addresses.nft!,
        abi: erc721Abi,
        functionName: "setApprovalForAll",
        args: [addresses.locking!, true],
      });
      return;
    }
    if (needToken) {
      await send(`${p.symbol} approved`, {
        address: p.token!,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.locking!, pay],
      });
      return;
    }
    const ok = await send(mode === "lock" ? "Guardian locked" : "Lock renewed", {
      address: addresses.locking!,
      abi: vyraLockingAbi,
      functionName: mode,
      args: [[g.id], [amount], [level]],
    });
    if (ok) {
      onClose();
      celebrate({ kind: mode, tokenId: g.id, tier: g.tier, level, image, days: Number(days) });
    }
  }

  const label = needNft
    ? "Let the Keep hold your guardian"
    : needToken
      ? `Approve ${fmtToken(pay, p.decimals)} ${p.symbol}`
      : mode === "lock"
        ? `Lock at Level ${level + 1}`
        : `Renew at Level ${level + 1}`;

  return (
    <Dialog
      title={`Guardian #${g.id.toString().padStart(4, "0")}`}
      kicker={<>◆ {mode === "lock" ? "Lock" : "Renew lock"}</>}
      image={image}
      onClose={onClose}
    >
      <div style={tierStyle(g.tier) as CSSProperties}>
        <div className="card-row" style={{ marginBottom: 14 }}>
          <TierBadge tier={g.tier} className="tier-badge tier-badge-inline" />
          <span className="faint" style={{ fontSize: "0.8rem" }}>
            {cfg ? bpsToPct(cfg.dailyRateBps) : "—"} daily on every level
          </span>
        </div>

        <div className="field">
          <span className="field-label">Level</span>
          <div className="level-picker" role="radiogroup" aria-label="Level">
            {levels.map((l, i) => {
              const open = l.maxAmount > 0n && (i === 0 || l.price > 0n);
              return (
                <button
                  key={i}
                  role="radio"
                  aria-checked={i === level}
                  className="level-tile"
                  disabled={!open || !!busy}
                  onClick={() => pickLevel(i)}
                >
                  <span className="level-tile-name">Lv {i + 1}</span>
                  <span className="level-tile-cap num">{open ? `≤ ${fmtToken(l.maxAmount, p.decimals, 0)}` : "—"}</span>
                  <span className="level-tile-fee num">{!open ? "closed" : i === 0 ? "free" : `+${fmtToken(l.price, p.decimals)}`}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="amount">
            <span>Amount to lock</span>
            <span className="num">
              {fmtToken(min, p.decimals)} – {fmtToken(max, p.decimals)} {p.symbol}
            </span>
          </label>
          <input
            id="amount"
            className="input"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(",", "."))}
          />
          <input
            className="range"
            type="range"
            min={0}
            max={1000}
            value={Math.round(pct * 10)}
            onChange={(e) => setFromSlider(Number(e.target.value))}
            style={{ "--pct": `${pct}%` } as CSSProperties}
            aria-label="Lock amount"
          />
          <div className="card-row faint">
            <span>{usd !== undefined && amount ? `≈ ${usdOf(a)}` : ""}</span>
            <span className="num">
              Balance {fmtToken(p.balance, p.decimals)} {p.symbol}
            </span>
          </div>
        </div>

        <div className="breakdown num">
          <div>
            <span className="dim">Locked (earns tribute)</span>
            <span>{fmtToken(a, p.decimals)}</span>
          </div>
          <div>
            <span className="dim">Level {level + 1} fee</span>
            <span>{fee > 0n ? fmtToken(fee, p.decimals) : "free"}</span>
          </div>
          <div>
            <span className="dim">You pay into the reward pool</span>
            <span>
              {fmtToken(pay, p.decimals)} {p.symbol}
            </span>
          </div>
          <div className="total">
            <span>
              Tribute: {fmtToken(daily, p.decimals)}/day × {days.toString()} days
            </span>
            <span style={{ color: "var(--tier)" }}>
              {fmtToken(total, p.decimals)} {p.symbol}
            </span>
          </div>
        </div>

        {mode === "renew" && unclaimed > 0n && (
          <p className="notice" style={{ marginTop: 0 }}>
            <span className="gem-sm" /> Your {fmtToken(unclaimed, p.decimals)} {p.symbol} of unclaimed tribute is paid out
            first.
          </p>
        )}
        {amount !== undefined && !inRange && <p className="notice notice-danger">Amount must be within Level {level + 1}&apos;s range.</p>}
        {short && <p className="notice notice-danger">Not enough {p.symbol} in your wallet.</p>}
        {poolShort && (
          <p className="notice notice-warn">The reward pool can&apos;t back this much tribute right now. Try a smaller amount.</p>
        )}

        <div className="steps" style={{ margin: "18px 0" }}>
          {mode === "lock" && (
            <div className={`step-line ${needNft ? "active" : "done"}`}>
              <span className="gem-sm" /> Let the Keep hold your guardian
            </div>
          )}
          <div className={`step-line ${needNft ? "" : needToken ? "active" : "done"}`}>
            <span className="gem-sm" /> Approve {fmtToken(pay, p.decimals)} {p.symbol}
          </div>
          <div className={`step-line ${!needNft && !needToken ? "active" : ""}`}>
            <span className="gem-sm" /> {mode === "lock" ? "Lock" : "Renew"}
          </div>
        </div>

        <button
          className="gbtn gbtn-lock gbtn-block gbtn-lg"
          disabled={!!busy || !inRange || short || poolShort || p.paused}
          onClick={act}
        >
          {busy ? <span className="spinner" /> : mode === "lock" ? <LockIcon /> : <RenewIcon />}
          {busy ?? label}
        </button>
        <p className="faint" style={{ fontSize: "0.76rem", textAlign: "center", marginTop: 12 }}>
          Your guardian stays in the Keep for {days.toString()} days and cannot leave early.
        </p>
      </div>
    </Dialog>
  );
}
