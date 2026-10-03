"use client";

import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits, type Abi, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useToast } from "@/components/Toaster";
import { LEVEL_COUNT, useProtocol, type Protocol } from "@/hooks/useProtocol";
import { useTokenUsd } from "@/hooks/useTokenUsd";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi, vyraRewardPoolAbi } from "@/lib/abis";
import { addresses, isConfigured } from "@/lib/env";
import { DAY, fmtDuration, fmtToken, fmtUsd, shortAddr } from "@/lib/format";
import { TIERS, tierOf } from "@/lib/tiers";
import { useChainNow } from "@/hooks/useChainNow";
import rarity from "@/contracts/data/vyra-rarity.json";

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function toUnits(v: string, decimals: number): bigint | undefined {
  try {
    return v.trim() === "" ? undefined : parseUnits(v.trim() as `${number}`, decimals);
  } catch {
    return undefined;
  }
}

const pctToBps = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/**
 * Owner writes. If the connected wallet is the owner, send directly; otherwise (owner is a Safe)
 * copy {to, data} so it can be pasted into the Safe Transaction Builder.
 */
function useOwnerAction(owner: Address | undefined) {
  const { address } = useAccount();
  const { send, busy } = useTx();
  const { push } = useToast();
  const isOwner = same(address, owner);

  async function run(label: string, to: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
    if (isOwner) return send(label, { address: to, abi, functionName, args } as Parameters<typeof send>[1]);
    const data = encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
    await navigator.clipboard.writeText(JSON.stringify({ to, value: "0", data }, null, 2));
    push({ kind: "info", title: "Safe calldata copied", body: `${label}: paste into the Safe Transaction Builder.` });
    return false;
  }
  return { run, busy, isOwner };
}

export function Council() {
  const p = useProtocol();
  const { address } = useAccount();
  if (!isConfigured) return <p className="notice" style={{ marginTop: 32 }}>Contract addresses are not configured.</p>;

  const isOwner = same(address, p.owner);

  return (
    <section className="section" style={{ marginTop: 40 }}>
      <div className="section-head">
        <div>
          <span className="kicker">◆ Council</span>
          <h2>Keep configuration</h2>
          <p className="lore">
            {isOwner
              ? "You hold the Keep. Changes are sent directly."
              : "You sign for the owner Safe. Actions copy calldata for the Safe Transaction Builder."}
          </p>
        </div>
      </div>
      <div className="admin-grid">
        {!p.token && <TokenCard p={p} />}
        {p.token && <PoolCard p={p} />}
        {p.token && <TiersCard p={p} />}
        <RarityCard p={p} />
        <Status p={p} />
        <EmergencyCard p={p} />
        <PeriodCard p={p} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- reward pool

function PoolCard({ p }: { p: Protocol }) {
  const poolOwner = useOwnerAction(p.poolOwner);
  const { send, busy } = useTx();
  const { address } = useAccount();
  const usd = useTokenUsd(p.token);
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [to, setTo] = useState("");
  const depAmt = toUnits(dep, p.decimals);
  const wdAmt = toUnits(wd, p.decimals);
  const needApprove = depAmt !== undefined && (p.allowancePool ?? 0n) < depAmt;

  const bal = p.poolBalance ?? 0n;
  const reserved = p.totalReserved ?? 0n;
  const free = p.poolAvailable ?? 0n;
  const reservedPct = bal > 0n ? Number((reserved * 1000n) / bal) / 10 : 0;
  const userIn = (p.totalLockPayments ?? 0n) + (p.totalLevelPayments ?? 0n);
  const net = userIn - (p.totalPaidOut ?? 0n); // what holders put in minus what they took out
  const days = Number(p.durationDays ?? 0);
  const subsidized = (p.tiers ?? []).map((t, i) => ({ i, full: (t.dailyRateBps * days) / 100 })).filter((t) => t.full > 100);
  const fmt = (v: bigint | undefined) => fmtToken(v, p.decimals, 2);
  const usdOf = (v: bigint | undefined) =>
    usd !== undefined && v !== undefined ? fmtUsd(Number(formatUnits(v, p.decimals)) * usd) : "";

  return (
    <div className="admin-card plate wide">
      <h3>Reward pool</h3>
      <p>
        Every lock payment and level fee lands here, and holders&apos; tribute is paid from here. Rewards for each lock are reserved
        when it starts. Only the free surplus can back new locks or be withdrawn by the owner.
      </p>

      <div className="pool-hero">
        <div>
          <span className="stat-label">Balance</span>
          <div className="pool-big num">
            {fmt(bal)} <small>{p.symbol}</small>
          </div>
          <span className="faint num">{usdOf(bal)}</span>
        </div>
        <div>
          <span className="stat-label">Reserved for holders</span>
          <div className="pool-big num" style={{ color: "var(--violet-2)" }}>
            {fmt(reserved)}
          </div>
          <span className="faint num">{usdOf(reserved)}</span>
        </div>
        <div>
          <span className="stat-label">Free surplus</span>
          <div className="pool-big num" style={{ color: "var(--aurum)" }}>
            {fmt(free)}
          </div>
          <span className="faint num">{usdOf(free)}</span>
        </div>
      </div>
      <div className="pool-bar" role="img" aria-label={`${reservedPct}% of the pool is reserved`}>
        <span className="pool-bar-reserved" style={{ width: `${reservedPct}%` }} />
      </div>
      <div className="card-row faint" style={{ fontSize: "0.76rem", marginTop: 6 }}>
        <span>◆ reserved {reservedPct}%</span>
        <span>free {Math.round((100 - reservedPct) * 10) / 10}% ◆</span>
      </div>

      <div className="pool-flows">
        <dl className="kv num">
          <dt>Lock payments in</dt>
          <dd>{fmt(p.totalLockPayments)}</dd>
          <dt>Level fees in</dt>
          <dd>{fmt(p.totalLevelPayments)}</dd>
          <dt>Deposits in (seed, donations)</dt>
          <dd>{fmt(p.totalDeposited)}</dd>
        </dl>
        <dl className="kv num">
          <dt>Tribute paid to holders</dt>
          <dd>{fmt(p.totalPaidOut)}</dd>
          <dt>Withdrawn by owner</dt>
          <dd>{fmt(p.totalWithdrawn)}</dd>
          <dt>Holders in − paid out</dt>
          <dd style={{ color: net >= 0n ? "var(--ok)" : "var(--danger)" }}>
            {net >= 0n ? "+" : "−"}
            {fmt(net >= 0n ? net : -net)}
          </dd>
        </dl>
      </div>

      {subsidized.length === 0 ? (
        <p className="notice" style={{ marginTop: 16 }}>
          <span className="gem-sm" /> Self-funding: every tier returns ≤ 100% over a lock, so each lock pays for its own tribute
          and level fees grow the pool. No top-ups needed.
        </p>
      ) : (
        <p className="notice notice-warn" style={{ marginTop: 16 }}>
          <span className="gem-sm" />
          <span>
            {subsidized.map((t) => `${TIERS[t.i].name} (${t.full}%)`).join(", ")} pay more than 100% over a lock. The extra
            comes from the seed and level fees, so watch the free surplus.
          </span>
        </p>
      )}

      <div className="admin-grid" style={{ marginTop: 18 }}>
        <div>
          <div className="field">
            <span className="field-label">
              <span>Deposit (anyone)</span>
              <span className="num">bal {fmtToken(p.balance, p.decimals)}</span>
            </span>
            <input className="input" placeholder={p.symbol} value={dep} onChange={(e) => setDep(e.target.value)} />
          </div>
          <button
            className="btn btn-gold btn-sm"
            disabled={!address || !depAmt || !!busy}
            onClick={() =>
              needApprove
                ? send(`${p.symbol} approved`, { address: p.token!, abi: erc20Abi, functionName: "approve", args: [addresses.pool!, depAmt!] })
                : send("Pool funded", { address: addresses.pool!, abi: vyraRewardPoolAbi, functionName: "deposit", args: [depAmt!] })
            }
          >
            {needApprove ? "Approve" : "Deposit"}
          </button>
        </div>
        <div>
          <div className="field">
            <span className="field-label">
              <span>Withdraw surplus (owner)</span>
              <button className="link-btn num" onClick={() => setWd(formatUnits(free, p.decimals))}>
                max {fmt(free)}
              </button>
            </span>
            <input className="input" placeholder={p.symbol} value={wd} onChange={(e) => setWd(e.target.value)} />
          </div>
          <div className="field">
            <input className="input" placeholder="to 0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} />
          </div>
          <button
            className="btn btn-sm"
            disabled={!wdAmt || !isAddress(to) || wdAmt > free || !!poolOwner.busy}
            onClick={() => poolOwner.run("Surplus withdrawn", addresses.pool!, vyraRewardPoolAbi, "withdrawSurplus", [to, wdAmt])}
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tiers & levels

interface LevelDraft {
  min: string;
  max: string;
  price: string;
}
interface TierDraft {
  rate: string;
  levels: LevelDraft[];
}

function validateTier(t: { dailyRateBps?: number; levels: { minAmount?: bigint; maxAmount?: bigint; price?: bigint }[] }) {
  const errs: string[] = Array(LEVEL_COUNT).fill("");
  if (t.dailyRateBps === undefined || t.dailyRateBps > 10_000) errs[0] = "daily % must be 0–100";
  t.levels.forEach((lv, i) => {
    if (lv.minAmount === undefined || lv.maxAmount === undefined || lv.price === undefined) return (errs[i] = "invalid number");
    if (lv.minAmount > lv.maxAmount) return (errs[i] = "min > max");
    if (i === 0 && lv.price !== 0n) return (errs[i] = "level 1 is free");
    if (i > 0) {
      const prev = t.levels[i - 1];
      if (lv.maxAmount > 0n && (prev.maxAmount === 0n || (prev.maxAmount ?? 0n) > lv.maxAmount)) return (errs[i] = "cap below previous level");
      if ((prev.price ?? 0n) > lv.price) return (errs[i] = "fee below previous level");
    }
  });
  return errs;
}

function TiersCard({ p }: { p: Protocol }) {
  const { run, busy } = useOwnerAction(p.owner);
  const usd = useTokenUsd(p.token);
  const [edits, setEdits] = useState<TierDraft[] | null>(null);
  const [open, setOpen] = useState(0);

  const draft: TierDraft[] | undefined =
    edits ??
    p.tiers?.map((t) => ({
      rate: String(t.dailyRateBps / 100),
      levels: t.levels.map((lv) => ({
        min: formatUnits(lv.minAmount, p.decimals),
        max: formatUnits(lv.maxAmount, p.decimals),
        price: formatUnits(lv.price, p.decimals),
      })),
    }));
  if (!draft) return null;

  const parsed = draft.map((t) => ({
    dailyRateBps: pctToBps(t.rate),
    levels: t.levels.map((lv) => ({
      minAmount: toUnits(lv.min || "0", p.decimals),
      maxAmount: toUnits(lv.max || "0", p.decimals),
      price: toUnits(lv.price || "0", p.decimals),
    })),
  }));
  const errors = parsed.map(validateTier);
  const valid = errors.every((e) => e.every((x) => !x));
  const days = p.durationDays ?? 0;

  const setRate = (ti: number, v: string) => setEdits(draft.map((t, j) => (j === ti ? { ...t, rate: v.replace(",", ".") } : t)));
  const setLevel = (ti: number, li: number, k: keyof LevelDraft, v: string) =>
    setEdits(
      draft.map((t, j) =>
        j === ti ? { ...t, levels: t.levels.map((lv, m) => (m === li ? { ...lv, [k]: v.replace(",", ".") } : lv)) } : t,
      ),
    );
  const usdOf = (v: string) => (usd !== undefined && v && Number(v) > 0 ? fmtUsd(Number(v) * usd) : "");

  return (
    <div className="admin-card plate wide">
      <h3>Tiers &amp; levels</h3>
      <p>
        Each rarity tier has one daily tribute % and 5 levels. A level sets how much a holder may lock; the holder picks it when
        locking and pays its fee into the pool. Level 1 is free. Max 0 closes a level.
        {usd !== undefined && (
          <>
            {" "}
            Right now 1 USD ≈ <span className="num">{(1 / usd).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {p.symbol}.
          </>
        )}
      </p>

      <div className="tier-tabs" role="tablist">
        {TIERS.map((t, i) => {
          const full = Number(draft[i].rate) * days;
          const bad = errors[i].some((e) => e);
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={open === i}
              className="tier-tab"
              style={{ ["--tier" as string]: t.color }}
              onClick={() => setOpen(i)}
            >
              {t.name}
              <span className={`pill ${bad ? "pill-bad" : full > 100 ? "pill-warn" : "pill-ok"}`}>{bad ? "fix" : `${Number.isFinite(full) ? full : "—"}%`}</span>
            </button>
          );
        })}
      </div>

      {(() => {
        const ti = open;
        const t = draft[ti];
        const full = Number(t.rate) * days;
        return (
          <div className="tier-editor" style={{ ["--tier" as string]: TIERS[ti].color }}>
            <div className="admin-actions" style={{ marginBottom: 14 }}>
              <label className="field-label" htmlFor={`rate-${ti}`} style={{ margin: 0 }}>
                Daily tribute %
              </label>
              <input id={`rate-${ti}`} className="input input-sm" style={{ width: 100 }} value={t.rate} onChange={(e) => setRate(ti, e.target.value)} />
              <span className="faint" style={{ fontSize: "0.8rem" }}>
                = {Number.isFinite(full) ? full : "—"}% over {days} days{" "}
                {full > 100 ? (
                  <span className="pill pill-warn">pool pays {(full - 100).toFixed(1)}% extra</span>
                ) : (
                  <span className="pill pill-ok">self-funding</span>
                )}
              </span>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Min lock</th>
                    <th>Max lock</th>
                    <th>Level fee</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {t.levels.map((lv, li) => {
                    return (
                      <tr key={li}>
                        <td style={{ color: "var(--tier)" }}>Level {li + 1}</td>
                        <td>
                          <input className="input input-sm" value={lv.min} onChange={(e) => setLevel(ti, li, "min", e.target.value)} />
                          <span className="faint num">{usdOf(lv.min)}</span>
                        </td>
                        <td>
                          <input className="input input-sm" value={lv.max} onChange={(e) => setLevel(ti, li, "max", e.target.value)} />
                          <span className="faint num">{usdOf(lv.max)}</span>
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            value={lv.price}
                            disabled={li === 0}
                            onChange={(e) => setLevel(ti, li, "price", e.target.value)}
                          />
                          <span className="faint num">{li === 0 ? "free" : usdOf(lv.price)}</span>
                        </td>
                        <td>{errors[ti][li] && <span className="pill pill-bad">{errors[ti][li]}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <div className="admin-actions" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary"
          disabled={!valid || !!busy}
          onClick={() => run("Tiers saved", addresses.locking!, vyraLockingAbi, "setTierConfigs", [parsed])}
        >
          Save all tiers
        </button>
        {edits && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEdits(null)}>
            Discard changes
          </button>
        )}
        <span className="faint" style={{ fontSize: "0.8rem" }}>
          Running locks keep their original terms.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- status

function Status({ p }: { p: Protocol }) {
  const { address } = useAccount();
  const locking = useOwnerAction(p.owner);
  const { send } = useTx();

  return (
    <div className="admin-card plate wide">
      <h3>State of the Keep</h3>
      <p>Live contract state. Both contracts use two-step ownership: a proposed owner must accept.</p>
      <dl className="kv num">
        <dt>Locking</dt>
        <dd>{addresses.locking}</dd>
        <dt>Reward pool</dt>
        <dd>{addresses.pool}</dd>
        <dt>NFT</dt>
        <dd>{addresses.nft}</dd>
        <dt>Token</dt>
        <dd>{p.token ? `${p.token} (${p.symbol}, ${p.decimals} dec)` : <span className="pill pill-warn">not set</span>}</dd>
        <dt>Owner (locking / pool)</dt>
        <dd>
          {shortAddr(p.owner)} / {shortAddr(p.poolOwner)}
          {p.pendingOwner && p.pendingOwner !== "0x0000000000000000000000000000000000000000" && (
            <span className="pill pill-warn" style={{ marginLeft: 8 }}>
              pending → {shortAddr(p.pendingOwner)}
            </span>
          )}
        </dd>
        <dt>Status</dt>
        <dd>
          {p.paused ? <span className="pill pill-bad">paused</span> : <span className="pill pill-ok">open</span>}{" "}
          {p.rarityLocked ? <span className="pill pill-ok">rarity locked</span> : <span className="pill pill-warn">rarity editable</span>}
        </dd>
        <dt>Guardians locked</dt>
        <dd>{p.totalLocked?.toString()}</dd>
      </dl>
      <div className="admin-actions" style={{ marginTop: 18 }}>
        <button
          className="btn btn-sm"
          disabled={!!locking.busy}
          onClick={() => locking.run(p.paused ? "Unpaused" : "Paused", addresses.locking!, vyraLockingAbi, p.paused ? "unpause" : "pause", [])}
        >
          {p.paused ? "Unpause locking" : "Pause locking"}
        </button>
        {same(address, p.pendingOwner) && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => send("Locking ownership accepted", { address: addresses.locking!, abi: vyraLockingAbi, functionName: "acceptOwnership" })}
          >
            Accept locking ownership
          </button>
        )}
        {same(address, p.poolPendingOwner) && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => send("Pool ownership accepted", { address: addresses.pool!, abi: vyraRewardPoolAbi, functionName: "acceptOwnership" })}
          >
            Accept pool ownership
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- emergency gate

/** Guardians listed (and returned per "Return all" transaction) at a time; keeps calls in gas limits. */
const EMERGENCY_BATCH = 50n;

function EmergencyCard({ p }: { p: Protocol }) {
  const { run, busy } = useOwnerAction(p.owner);
  const now = useChainNow();
  const locking = { address: addresses.locking!, abi: vyraLockingAbi } as const;
  const count = useReadContract({ ...locking, functionName: "allLockedCount", query: { refetchInterval: 30_000 } }).data ?? 0n;
  const ids = useReadContract({
    ...locking,
    functionName: "allLockedTokens",
    args: [0n, EMERGENCY_BATCH],
    query: { enabled: count > 0n, refetchInterval: 30_000 },
  }).data;
  const locks = useReadContract({
    ...locking,
    functionName: "locksOf",
    args: [ids ?? []],
    query: { enabled: !!ids?.length, refetchInterval: 30_000 },
  }).data;

  const rows = (ids ?? []).map((id, i) => ({ id, lock: locks?.[i] })).filter((r) => r.lock);
  const returnAll = () =>
    confirm(
      `Return ${count > EMERGENCY_BATCH ? `the next ${EMERGENCY_BATCH}` : `all ${count}`} locked guardians to their holders now? ` +
        "Each holder is paid their full period's reward. This cannot be undone.",
    ) && run("Guardians returned", addresses.locking!, vyraLockingAbi, "emergencyReturnAll", [EMERGENCY_BATCH]);

  return (
    <div className="admin-card plate wide">
      <h3>Emergency gate</h3>
      <p>
        Send locked guardians straight back to their holders before their period ends. Each holder is paid the full
        period&apos;s reward, which the pool reserved when the lock opened, so nobody loses tribute. Works while paused; pause
        first if new locks should stop too.
      </p>
      <div className="admin-actions" style={{ marginBottom: 14 }}>
        <span className="pill">{count.toString()} locked</span>
        <button className="btn btn-sm" disabled={count === 0n || !!busy} onClick={returnAll}>
          {count > EMERGENCY_BATCH ? `Return next ${EMERGENCY_BATCH}` : "Return all"}
        </button>
      </div>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="table num">
            <thead>
              <tr>
                <th>Guardian</th>
                <th>Holder</th>
                <th>Tier · level</th>
                <th>Locked</th>
                <th>Ends</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, lock }) => {
                const end = Number(lock!.start) + lock!.durationDays * DAY;
                const left = end - now;
                return (
                  <tr key={id.toString()}>
                    <td>#{id.toString()}</td>
                    <td>{shortAddr(lock!.owner)}</td>
                    <td style={{ color: tierOf(lock!.tier).color }}>
                      {tierOf(lock!.tier).name} · {lock!.level + 1}
                    </td>
                    <td>
                      {fmtToken(lock!.amount, p.decimals, 2)} {p.symbol}
                    </td>
                    <td>{left > 0 ? `in ${fmtDuration(left)}` : "ended"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={!!busy}
                        onClick={() =>
                          confirm(`Return #${id} to ${lock!.owner} now, with its full period's reward?`) &&
                          run(`Guardian #${id} returned`, addresses.locking!, vyraLockingAbi, "emergencyReturn", [[id]])
                        }
                      >
                        Return
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- token

function TokenCard({ p }: { p: Protocol }) {
  const { run, busy } = useOwnerAction(p.owner);
  const [addr, setAddr] = useState("");
  return (
    <div className="admin-card plate wide">
      <h3>Token</h3>
      <p>The token used for locks, level-ups and rewards. It can be set only once, so check the address twice.</p>
      <div className="admin-actions">
        <input className="input" style={{ flex: 1, minWidth: 260 }} placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        <button
          className="btn btn-primary"
          disabled={!isAddress(addr) || !!busy}
          onClick={() => confirm(`Set ${addr} as the token forever?`) && run("Token set", addresses.locking!, vyraLockingAbi, "setToken", [addr])}
        >
          Set token
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- period

function PeriodCard({ p }: { p: Protocol }) {
  const { run, busy } = useOwnerAction(p.owner);
  const [days, setDays] = useState("");
  const n = Number(days);
  return (
    <div className="admin-card plate">
      <h3>Lock period</h3>
      <p>
        Currently <b>{p.durationDays ?? "—"} days</b>. Applies to new locks and renewals (1–365).
      </p>
      <div className="admin-actions">
        <input className="input" style={{ width: 120 }} inputMode="numeric" placeholder="days" value={days} onChange={(e) => setDays(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={!Number.isInteger(n) || n < 1 || n > 365 || !!busy}
          onClick={() => run("Lock period set", addresses.locking!, vyraLockingAbi, "setDurationDays", [n])}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rarity

const collectionWords = rarity.words.map((w) => BigInt(w));

function RarityCard({ p }: { p: Protocol }) {
  const { run, busy } = useOwnerAction(p.owner);
  const [lookup, setLookup] = useState("");
  const onChain = p.rarityWords;
  const matches = !!onChain && onChain.length === collectionWords.length && onChain.every((w, i) => w === collectionWords[i]);
  const empty = !!onChain && onChain.every((w) => w === 0n);
  const locked = !!p.rarityLocked;

  const id = Number(lookup);
  const validId = Number.isInteger(id) && id >= 1 && id <= 1111;
  const chainTier = validId && onChain ? Number((onChain[Math.floor(id / 64)] >> BigInt((id % 64) * 4)) & 0xfn) : undefined;
  const fileTier = validId ? (rarity.byId as Record<string, string>)[String(id)] : undefined;

  return (
    <div className="admin-card plate wide">
      <h3>Rarity map</h3>
      <p>
        Each guardian&apos;s tier comes from the collection&apos;s <b>Rarity</b> trait (OpenSea), stored on-chain as a packed map:
        4 bits per guardian, 18 slots for all 1,111. Upload once, verify, then lock it forever.
      </p>

      <div className="rarity-counts">
        {TIERS.map((t) => (
          <div key={t.id} style={{ ["--tier" as string]: t.color }}>
            <span className="gem-sm" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
            <b>{t.name}</b>
            <span className="num">{(rarity.counts as Record<string, number>)[t.name]}</span>
          </div>
        ))}
      </div>

      <div className="admin-actions" style={{ margin: "16px 0" }}>
        {matches ? (
          <span className="pill pill-ok">on-chain map matches the collection</span>
        ) : empty ? (
          <span className="pill pill-warn">not uploaded: every guardian reads as Common</span>
        ) : (
          <span className="pill pill-bad">on-chain map differs from the collection data</span>
        )}
        {locked ? <span className="pill pill-ok">locked forever</span> : <span className="pill pill-warn">editable</span>}
      </div>

      <div className="admin-actions">
        {!locked && !matches && (
          <button
            className="btn btn-primary btn-sm"
            disabled={!!busy}
            onClick={() => run("Rarity map uploaded", addresses.locking!, vyraLockingAbi, "setRarityWords", [0n, collectionWords])}
          >
            Upload collection rarity
          </button>
        )}
        {!locked && matches && (
          <button
            className="btn btn-sm"
            disabled={!!busy}
            onClick={() => confirm("Lock rarity forever? This cannot be undone.") && run("Rarity locked", addresses.locking!, vyraLockingAbi, "lockRarity", [])}
          >
            Lock forever
          </button>
        )}
        <input className="input input-sm" style={{ width: 130 }} placeholder="check id…" value={lookup} onChange={(e) => setLookup(e.target.value)} />
        {validId && (
          <span className="num" style={{ fontSize: "0.84rem" }}>
            #{id}: collection <b style={{ color: TIERS.find((t) => t.name === fileTier)?.color }}>{fileTier}</b> · on-chain{" "}
            <b style={{ color: TIERS[chainTier ?? 0]?.color }}>{chainTier !== undefined ? TIERS[chainTier]?.name : "—"}</b>
          </span>
        )}
      </div>
    </div>
  );
}
