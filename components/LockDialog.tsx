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
import { ShortNotice } from "./ShortNotice";
import { TierBadge, tierStyle } from "./TierBadge";
import { WalletHint } from "./WalletHint";

const BPS = 10_000n;

type StepKey = "nft" | "token" | "act";

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
  onLocked,
}: {
  guardian: Guardian;
  protocol: Protocol;
  mode: "lock" | "renew";
  onClose: () => void;
  /** Called with the guardian's id once the lock or renewal lands. */
  onLocked?: (ids: bigint[]) => void;
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

  // Approvals made in this dialog count right away, even if the RPC hasn't caught up yet.
  const [granted, setGranted] = useState(false);
  const [approved, setApproved] = useState(0n);
  const [running, setRunning] = useState<StepKey | null>(null);
  const [error, setError] = useState<string>();
  const [planned, setPlanned] = useState(0);

  const checking = (mode === "lock" && p.nftApproved === undefined) || p.allowanceLocking === undefined;
  const needNft = mode === "lock" && !p.nftApproved && !granted;
  const needToken = (p.allowanceLocking ?? 0n) < pay && approved < pay;
  // Renewing never moves the NFT, so only new locks depend on the collection's allow-list.
  const blocked = mode === "lock" && p.keepAllowed === false;
  const short = p.balance !== undefined && p.balance < pay;
  // the payment lands in the pool before this lock's rewards are reserved
  const poolShort = p.poolAvailable !== undefined && total > p.poolAvailable + pay;
  const unclaimed = g.pending ?? 0n;

  const usdOf = (v: bigint) => (usd !== undefined ? fmtUsd(Number(formatUnits(v, p.decimals)) * usd) : "");

  function pickLevel(i: number) {
    setLevel(i);
    setInput(formatUnits(levels[i].maxAmount, p.decimals));
  }

  const presets = [
    { label: "Min", value: min },
    { label: "Half", value: min + (max - min) / 2n },
    { label: "Max", value: max },
  ];

  function setFromSlider(permille: number) {
    setInput(formatUnits(min + ((max - min) * BigInt(permille)) / 1000n, p.decimals));
  }

  const steps: { key: StepKey; label: string; needed: boolean }[] = [
    ...(mode === "lock" ? [{ key: "nft" as const, label: "Let the Keep hold your guardian", needed: needNft }] : []),
    { key: "token", label: `Approve ${fmtToken(pay, p.decimals)} ${p.symbol}`, needed: needToken },
    { key: "act", label: mode === "lock" ? `Lock at Level ${level + 1}` : `Renew at Level ${level + 1}`, needed: true },
  ];
  const todo = steps.filter((s) => s.needed);

  /** Runs every step still needed, one wallet confirmation each, without extra clicks. */
  async function act() {
    if (!amount) return;
    setError(undefined);
    setPlanned(todo.length);
    const onError = setError;
    try {
      if (needNft) {
        setRunning("nft");
        const ok = await send(
          "Keep access granted",
          { address: addresses.nft!, abi: erc721Abi, functionName: "setApprovalForAll", args: [addresses.locking!, true] },
          { onError },
        );
        if (!ok) return;
        setGranted(true);
      }
      if (needToken) {
        setRunning("token");
        const ok = await send(
          `${p.symbol} approved`,
          { address: p.token!, abi: erc20Abi, functionName: "approve", args: [addresses.locking!, pay] },
          { onError },
        );
        if (!ok) return;
        setApproved(pay);
      }
      setRunning("act");
      const ok = await send(
        mode === "lock" ? "Guardian locked" : "Lock renewed",
        { address: addresses.locking!, abi: vyraLockingAbi, functionName: mode, args: [[g.id], [amount], [level]] },
        { onError },
      );
      if (ok) {
        onLocked?.([g.id]);
        onClose();
        celebrate({ kind: mode, tokenId: g.id, tier: g.tier, level, image, days: Number(days) });
      }
    } finally {
      setRunning(null);
    }
  }

  const label = checking
    ? "Checking your wallet…"
    : blocked
      ? "Locking opens soon"
      : running
        ? `Step ${planned - todo.length + 1} of ${planned} · confirm in wallet`
        : todo.length > 1
          ? `${steps[steps.length - 1].label} · ${todo.length} quick steps`
          : steps[steps.length - 1].label;

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
          <div className="amount-presets" role="group" aria-label="Quick amounts">
            {presets.map((x) => (
              <button
                key={x.label}
                type="button"
                className="amount-preset"
                aria-pressed={amount === x.value}
                disabled={max === 0n || !!busy}
                onClick={() => setInput(formatUnits(x.value, p.decimals))}
              >
                {x.label}
              </button>
            ))}
          </div>
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
        <ShortNotice protocol={p} pay={pay} />
        {poolShort && (
          <p className="notice notice-warn">The reward pool can&apos;t back this much tribute right now. Try a smaller amount.</p>
        )}

        {blocked && (
          <p className="notice notice-warn">
            <span className="gem-sm" /> The VYRA collection hasn&apos;t enabled the Keep contract yet, so guardians can&apos;t
            be locked right now. Nothing will be charged. This opens as soon as the collection owner allows it.
          </p>
        )}
        {error && <p className="notice notice-danger">{error}</p>}

        {!checking && !blocked && !running && <WalletHint count={todo.length} oneTime={needNft} />}
        {!checking && !blocked && (todo.length > 1 || (running !== null && planned > 1)) && (
          <div className="steps" style={{ margin: "18px 0" }}>
            {steps.map((s) => {
              const done = !s.needed;
              const active = running === s.key;
              return (
                <div key={s.key} className={`step-line ${done ? "done" : active ? "active" : ""}`}>
                  {active ? <span className="spinner" /> : <span className="gem-sm" />} {s.label}
                  {done && <span className="step-check">✓</span>}
                </div>
              );
            })}
          </div>
        )}

        <button
          className="gbtn gbtn-lock gbtn-block gbtn-lg"
          disabled={!!busy || checking || blocked || !inRange || short || poolShort || p.paused}
          onClick={act}
        >
          {busy || checking ? <span className="spinner" /> : mode === "lock" ? <LockIcon /> : <RenewIcon />}
          {label}
        </button>
        <p className="faint" style={{ fontSize: "0.76rem", textAlign: "center", marginTop: 12 }}>
          Your guardian stays in the Keep for {days.toString()} days and cannot leave early.
        </p>
      </div>
    </Dialog>
  );
}
