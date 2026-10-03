"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";
import { useAccount } from "wagmi";
import { useChainNow } from "@/hooks/useChainNow";
import { noteReturned, unclaimedDays, useGuardians, type Guardian } from "@/hooks/useGuardians";
import { topLevel, useProtocol } from "@/hooks/useProtocol";
import { useTx } from "@/hooks/useTx";
import { vyraLockingAbi, vyraRewardPoolAbi } from "@/lib/abis";
import { addresses, isConfigured } from "@/lib/env";
import { bpsToPct, fmtToken, plural } from "@/lib/format";
import { TIERS } from "@/lib/tiers";
import { burstFrom } from "./fx/burst";
import { CountUp } from "./fx/CountUp";
import { Embers } from "./fx/Embers";
import { GuardianCard } from "./GuardianCard";
import { ClaimIcon } from "./icons";
import { LevelUpDialog } from "./LevelUpDialog";
import { LockDialog } from "./LockDialog";
import { Roster } from "./Roster";
import { tierStyle } from "./TierBadge";
import { WalletButton } from "./WalletButton";

type Modal = { kind: "lock" | "renew" | "levelup"; guardian: Guardian } | null;

const SUPPLY = 1111;

export function Keep() {
  const { isConnected } = useAccount();
  const p = useProtocol();
  const gs = useGuardians();
  const now = useChainNow();
  const { send, busy } = useTx();
  const [modal, setModal] = useState<Modal>(null);

  if (!isConfigured) return <NotConfigured />;

  const claimable = gs.locked.filter((g) => (g.pending ?? 0n) > 0n);
  const owedDays = claimable.reduce((n, g) => n + (unclaimedDays(g, now) ?? 0), 0);

  const claim = async (ids: bigint[], from?: HTMLElement) => {
    const ok = await send("Tribute claimed", {
      address: addresses.pool!,
      abi: vyraRewardPoolAbi,
      functionName: "claim",
      args: [ids],
    });
    if (ok) burstFrom(from ?? null);
  };
  const unlock = async (id: bigint) => {
    noteReturned([id]); // shown in the wallet list as soon as ownerOf confirms it, before the explorer catches up
    await send("Guardian unlocked", { address: addresses.locking!, abi: vyraLockingAbi, functionName: "unlock", args: [[id]] });
  };

  // Re-resolve the guardian on every render so dialogs see fresh level/allowance data after a tx.
  const modalGuardian = modal && gs.guardians.find((g) => g.id === modal.guardian.id);

  const cardProps = (g: Guardian, i: number) => ({
    guardian: g,
    protocol: p,
    now,
    index: i,
    busy: !!busy,
    onLock: () => setModal({ kind: "lock", guardian: g }),
    onRenew: () => setModal({ kind: "renew", guardian: g }),
    onLevelUp: () => setModal({ kind: "levelup", guardian: g }),
    onClaim: (from: HTMLElement) => claim([g.id], from),
    onUnlock: () => unlock(g.id),
  });

  return (
    <>
      <section className="hero plate" onPointerMove={parallax}>
        <div className="hero-art" aria-hidden />
        <Embers density={70} className="hero-embers" />
        <div className="hero-body">
          <span className="kicker">
            <span className="gem-sm gem-pulse" /> The Keep · Ink Chain
          </span>
          <h1>Lock your Guardian</h1>
          <p className="lore">
            Keep the vigil. <b>Claim your tribute.</b>
          </p>
          <div className="hero-actions">
            {isConnected ? (
              <button
                className="gbtn gbtn-gold gbtn-lg"
                disabled={claimable.length === 0 || !!busy}
                onClick={(e) => claim(claimable.map((g) => g.id), e.currentTarget)}
              >
                {busy === "Tribute claimed" ? <span className="spinner" /> : <ClaimIcon />}
                {owedDays ? `Claim ${plural(owedDays, "day")}` : "Claim all"} · {fmtToken(gs.totalPending, p.decimals)} {p.symbol}
              </button>
            ) : (
              <WalletButton label="Summon your guardians" />
            )}
            <a className="btn btn-ghost" href="#rite">
              How it works
            </a>
          </div>
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Guardians locked</div>
          <div className="stat-value num">
            <CountUp value={p.totalLocked === undefined ? undefined : Number(p.totalLocked)} maxFrac={0} />
            <small>/ {SUPPLY}</small>
          </div>
          <div className="progress stat-progress">
            <span style={{ width: `${(Number(p.totalLocked ?? 0) / SUPPLY) * 100}%` }} />
          </div>
        </div>
        <div className="stat stat-pool">
          <div className="stat-label">Reward pool</div>
          <div className="stat-value num">
            <CountUp value={p.poolBalance} decimals={p.decimals} maxFrac={0} />
            <small>{p.symbol}</small>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Paid to holders</div>
          <div className="stat-value num">
            <CountUp value={p.totalPaidOut} decimals={p.decimals} />
            <small>{p.symbol}</small>
          </div>
        </div>
        <div className="stat stat-gold">
          <div className="stat-label">Your tribute due</div>
          <div className="stat-value num">
            {isConnected ? <CountUp value={gs.totalPending} decimals={p.decimals} maxFrac={4} /> : "—"}
            <small>{p.symbol}</small>
          </div>
        </div>
      </div>

      {p.paused && (
        <p className="notice notice-warn" style={{ marginTop: 18 }}>
          <span className="gem-sm" /> The Keep is sealed for now. New locks and level-ups are paused. Claiming and unlocking
          still work.
        </p>
      )}
      {p.keepAllowed === false && (
        <p className="notice notice-warn" style={{ marginTop: 18 }}>
          <span className="gem-sm" /> Locking opens soon. The VYRA collection still has to enable the Keep contract. Claiming
          and unlocking are not affected.
        </p>
      )}
      {!p.isLoading && !p.token && (
        <p className="notice" style={{ marginTop: 18 }}>
          <span className="gem-sm" /> The Keep is being prepared. The token hasn&apos;t been set yet.
        </p>
      )}

      {!isConnected ? (
        <section className="section">
          <div className="empty plate">
            <span className="kicker">◆ Guardians await</span>
            <p className="lore">Connect your wallet to see your guardians in the Keep.</p>
            <WalletButton />
          </div>
        </section>
      ) : (
        <Roster
          locked={gs.locked}
          idle={gs.idle}
          totalPending={gs.totalPending}
          owedDays={owedDays}
          isLoading={gs.isLoading}
          protocol={p}
          busy={!!busy}
          claiming={busy === "Tribute claimed"}
          onClaimAll={(from) => claim(claimable.map((g) => g.id), from)}
          renderCard={(g, i) => <GuardianCard {...cardProps(g, i)} />}
        />
      )}

      <section className="section" id="rite">
        <div className="section-head">
          <div>
            <span className="kicker">◆ The rite</span>
            <h2>How the Keep works</h2>
          </div>
        </div>
        <div className="rite">
          <div className="rite-step plate">
            <span className="roman">I</span>
            <h3>Lock</h3>
            <p>
              Pick a level and an amount inside its range. Level 1 is free; higher levels let you lock more for a fee. Every
              token goes into the reward pool. Nothing is burned.
            </p>
          </div>
          <div className="rite-step plate">
            <span className="roman">II</span>
            <h3>Keep vigil</h3>
            <p>
              Your guardian stays in the Keep for {p.durationDays ?? "—"} days. Each full day earns a share of your lock as
              tribute, paid from the pool. Unclaimed days carry over.
            </p>
          </div>
          <div className="rite-step plate">
            <span className="roman">III</span>
            <h3>Claim, renew or unlock</h3>
            <p>
              Claim any time. When the lock ends, renew without moving your guardian, or unlock it with any tribute still owed.
            </p>
          </div>
        </div>

        <div className="ledger" style={{ marginTop: 16 }}>
          {TIERS.map((t) => {
            const cfg = p.tiers?.[t.id];
            const top = topLevel(cfg);
            const full = cfg ? (cfg.dailyRateBps * Number(p.durationDays ?? 0)) / 100 : 0;
            const l1 = cfg?.levels[0];
            const lTop = top >= 0 ? cfg?.levels[top] : undefined;
            return (
              <div key={t.id} className="ledger-cell plate" style={tierStyle(t.id) as CSSProperties}>
                <h3>
                  <span className="gem-sm" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
                  {t.name}
                </h3>
                <span className="faint" style={{ fontSize: "0.76rem", letterSpacing: "0.12em" }}>
                  {t.material.toUpperCase()}
                </span>
                <dl className="num">
                  <div>
                    <dt>Level 1</dt>
                    <dd>{l1 && l1.maxAmount > 0n ? `${fmtToken(l1.minAmount, p.decimals)}–${fmtToken(l1.maxAmount, p.decimals)}` : "closed"}</dd>
                  </div>
                  <div>
                    <dt>Level {top + 1 || "—"}</dt>
                    <dd>{lTop ? `${fmtToken(lTop.minAmount, p.decimals)}–${fmtToken(lTop.maxAmount, p.decimals)}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Daily tribute</dt>
                    <dd>{cfg ? bpsToPct(cfg.dailyRateBps) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Full lock</dt>
                    <dd>{full ? `${full}%` : "—"}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
        <p className="lore" style={{ marginTop: 18, fontSize: "1.1rem" }}>
          Each tier has 5 levels. You choose the level when you lock, and can level up a running lock to lock more and earn
          more for the days left.
        </p>
      </section>

      {modal && modalGuardian && modal.kind !== "levelup" && (
        <LockDialog guardian={modalGuardian} protocol={p} mode={modal.kind} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "levelup" && modalGuardian?.lock && (
        <LevelUpDialog guardian={modalGuardian} protocol={p} now={now} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function NotConfigured() {
  return (
    <section className="section">
      <div className="empty plate">
        <span className="kicker">◆ The Keep is not bound</span>
        <p className="lore">Contract addresses are missing.</p>
        <p className="dim" style={{ fontSize: "0.86rem" }}>
          Set <code>NEXT_PUBLIC_LOCKING_ADDRESS</code>, <code>NEXT_PUBLIC_POOL_ADDRESS</code> and{" "}
          <code>NEXT_PUBLIC_NFT_ADDRESS</code> in <code>.env.local</code>. See <code>.env.example</code>.
        </p>
      </div>
    </section>
  );
}

/** Guardian art drifts against the cursor. */
function parallax(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--px", `${(e.clientX - r.left) / r.width - 0.5}`);
  e.currentTarget.style.setProperty("--py", `${(e.clientY - r.top) / r.height - 0.5}`);
}
