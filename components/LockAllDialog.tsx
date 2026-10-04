"use client";

import { useState, type CSSProperties } from "react";
import { erc20Abi, erc721Abi } from "viem";
import type { Guardian } from "@/hooks/useGuardians";
import { maxTribute, type Protocol } from "@/hooks/useProtocol";
import { useTokenUsd } from "@/hooks/useTokenUsd";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi } from "@/lib/abis";
import { addresses } from "@/lib/env";
import { fmtToken, plural, usdOf } from "@/lib/format";
import { tierOf } from "@/lib/tiers";
import { Dialog } from "./Dialog";
import { useCeremony } from "./fx/Ceremony";
import { GuardianArt, useGuardianImage } from "./GuardianArt";
import { LockIcon } from "./icons";
import { ShortNotice } from "./ShortNotice";
import { tierStyle } from "./TierBadge";
import { WalletHint } from "./WalletHint";

const BPS = 10_000n;

type StepKey = "nft" | "token" | "act";

/** Levels a new lock can pick: configured, and (past level 1) priced. */
const openLevels = (p: Protocol, g: Guardian) =>
  (p.tiers?.[g.tier]?.levels ?? []).flatMap((l, i) => (l.maxAmount > 0n && (i === 0 || l.price > 0n) ? [i] : []));

/**
 * Locks every chosen idle guardian in one transaction (the contract takes arrays).
 * Each guardian locks its level's full amount; the single-guardian dialog is there for finer control.
 */
export function LockAllDialog({
  guardians,
  protocol: p,
  onClose,
  onLocked,
}: {
  guardians: Guardian[];
  protocol: Protocol;
  onClose: () => void;
  onLocked?: (ids: bigint[]) => void;
}) {
  const usd = useTokenUsd(p.token);
  const { send, busy } = useTx();
  const celebrate = useCeremony();

  const lockable = guardians.filter((g) => openLevels(p, g).length > 0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(lockable.map((g) => g.id.toString())));
  const [levels, setLevels] = useState<Record<string, number>>({});

  const rows = lockable.map((g) => {
    const key = g.id.toString();
    const cfg = p.tiers![g.tier];
    const level = levels[key] ?? 0;
    const lv = cfg.levels[level];
    const amount = lv.maxAmount;
    const tribute = ((amount * BigInt(cfg.dailyRateBps)) / BPS) * BigInt(p.durationDays ?? 0);
    return { g, key, level, amount, fee: lv.price, tribute, on: picked.has(key) };
  });
  const chosen = rows.filter((r) => r.on);
  const sum = (f: (r: (typeof rows)[number]) => bigint) => chosen.reduce((a, r) => a + f(r), 0n);
  const locked = sum((r) => r.amount);
  const fees = sum((r) => r.fee);
  const pay = locked + fees;
  const tribute = sum((r) => r.tribute);
  const bestUpside = rows.reduce((a, r) => a + (maxTribute(p.tiers?.[r.g.tier], p.durationDays) ?? 0n), 0n);
  const lead = [...chosen].sort((a, b) => b.g.tier - a.g.tier)[0]?.g ?? lockable[0];
  const leadImage = useGuardianImage(lead?.id ?? 0n);

  // Approvals made in this dialog count right away, even if the RPC hasn't caught up yet.
  const [granted, setGranted] = useState(false);
  const [approved, setApproved] = useState(0n);
  const [running, setRunning] = useState<StepKey | null>(null);
  const [error, setError] = useState<string>();
  const [planned, setPlanned] = useState(0);

  const checking = p.nftApproved === undefined || p.allowanceLocking === undefined;
  const needNft = !p.nftApproved && !granted;
  const needToken = (p.allowanceLocking ?? 0n) < pay && approved < pay;
  const blocked = p.keepAllowed === false;
  const short = p.balance !== undefined && p.balance < pay;
  const poolShort = p.poolAvailable !== undefined && tribute > p.poolAvailable + pay;

  const steps: { key: StepKey; label: string; needed: boolean }[] = [
    { key: "nft", label: "Let the Keep hold your guardians", needed: needNft },
    { key: "token", label: `Approve ${fmtToken(pay, p.decimals)} ${p.symbol}`, needed: needToken },
    { key: "act", label: `Lock ${plural(chosen.length, "guardian")}`, needed: true },
  ];
  const todo = steps.filter((s) => s.needed);

  function toggle(key: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function act() {
    if (chosen.length === 0) return;
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
      const ids = chosen.map((r) => r.g.id);
      const ok = await send(
        chosen.length === 1 ? "Guardian locked" : `${chosen.length} guardians locked`,
        {
          address: addresses.locking!,
          abi: vyraLockingAbi,
          functionName: "lock",
          args: [ids, chosen.map((r) => r.amount), chosen.map((r) => r.level)],
        },
        { onError },
      );
      if (ok) {
        onLocked?.(ids);
        onClose();
        const top = [...chosen].sort((a, b) => b.g.tier - a.g.tier)[0];
        celebrate({ kind: "lock", tokenId: top.g.id, tier: top.g.tier, level: top.level, image: leadImage, days: Number(p.durationDays ?? 0) });
      }
    } finally {
      setRunning(null);
    }
  }

  const label = checking
    ? "Checking your wallet…"
    : blocked
      ? "Locking opens soon"
      : chosen.length === 0
        ? "Pick a guardian to lock"
        : running
          ? `Step ${planned - todo.length + 1} of ${planned} · confirm in wallet`
          : `Lock ${plural(chosen.length, "guardian")}`;

  return (
    <Dialog title={`Lock ${plural(lockable.length, "guardian")}`} kicker={<>◆ Lock all</>} image={leadImage} onClose={onClose}>
      <p className="dim" style={{ margin: "-8px 0 16px", fontSize: "0.84rem" }}>
        Each guardian locks its level&apos;s full amount. Level 1 has no fee. Higher levels earn more
        {bestUpside > 0n && <>, up to {fmtToken(bestUpside, p.decimals, 0)} {p.symbol} across all of them</>}.
      </p>

      <ul className="lockall-list">
        {rows.map((r) => {
          const t = tierOf(r.g.tier);
          return (
            <li
              key={r.key}
              className={`lockall-row${r.on ? "" : " is-off"}`}
              style={tierStyle(r.g.tier) as CSSProperties}
            >
              <label className="lockall-pick">
                <input type="checkbox" checked={r.on} disabled={!!busy} onChange={() => toggle(r.key)} />
                <span className="lockall-thumb">
                  <GuardianArt tokenId={r.g.id} />
                </span>
                <span className="lockall-name">
                  <b>#{r.g.id.toString().padStart(4, "0")}</b>
                  <small style={{ color: t.color }}>{t.name}</small>
                </span>
              </label>
              <select
                className="input input-sm lockall-level"
                aria-label={`Level for guardian #${r.key}`}
                value={r.level}
                disabled={!r.on || !!busy}
                onChange={(e) => setLevels((s) => ({ ...s, [r.key]: Number(e.target.value) }))}
              >
                {openLevels(p, r.g).map((i) => {
                  const lv = p.tiers![r.g.tier].levels[i];
                  return (
                    <option key={i} value={i}>
                      Lv {i + 1} · {fmtToken(lv.maxAmount, p.decimals, 0)}
                      {i === 0 ? " · free" : ` · +${fmtToken(lv.price, p.decimals)} fee`}
                    </option>
                  );
                })}
              </select>
              <span className="lockall-earn num">
                +{fmtToken(r.tribute, p.decimals, 0)}
                <small>{p.symbol}</small>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="breakdown num">
        <div>
          <span className="dim">Locked (earns tribute)</span>
          <span>{fmtToken(locked, p.decimals)}</span>
        </div>
        <div>
          <span className="dim">Level fees</span>
          <span>{fees > 0n ? fmtToken(fees, p.decimals) : "free"}</span>
        </div>
        <div>
          <span className="dim">You pay into the reward pool</span>
          <span>
            {fmtToken(pay, p.decimals)} {p.symbol}
          </span>
        </div>
        <div className="total">
          <span>Tribute over {p.durationDays ?? "—"} days</span>
          <span style={{ color: "var(--aurum)" }}>
            {fmtToken(tribute, p.decimals)} {p.symbol}
            {usd !== undefined && tribute > 0n && <small className="faint"> {usdOf(tribute, p.decimals, usd)}</small>}
          </span>
        </div>
      </div>

      <ShortNotice protocol={p} pay={pay} />
      {poolShort && (
        <p className="notice notice-warn">The reward pool can&apos;t back this much tribute right now. Lock fewer guardians or lower levels.</p>
      )}
      {blocked && (
        <p className="notice notice-warn">
          <span className="gem-sm" /> The VYRA collection hasn&apos;t enabled the Keep contract yet, so guardians can&apos;t be
          locked right now. Nothing will be charged.
        </p>
      )}
      {error && <p className="notice notice-danger">{error}</p>}

      {!checking && !blocked && !running && chosen.length > 0 && <WalletHint count={todo.length} oneTime={needNft} />}
      {!checking && !blocked && chosen.length > 0 && (todo.length > 1 || (running !== null && planned > 1)) && (
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
        className="gbtn gbtn-jade gbtn-block gbtn-lg"
        disabled={!!busy || checking || blocked || chosen.length === 0 || short || poolShort || p.paused}
        onClick={act}
      >
        {busy || checking ? <span className="spinner" /> : <LockIcon />}
        {label}
      </button>
      <p className="faint" style={{ fontSize: "0.76rem", textAlign: "center", marginTop: 12 }}>
        Your guardians stay in the Keep for {p.durationDays ?? "—"} days and cannot leave early.
      </p>
    </Dialog>
  );
}
