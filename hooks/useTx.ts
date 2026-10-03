"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { activeChain } from "@/lib/env";
import { useToast } from "@/components/Toaster";

const FRIENDLY: Record<string, string> = {
  AmountOutOfRange: "Amount is outside the range of this tier and level.",
  InsufficientPool: "The reward pool can't back this lock right now. Try a smaller amount or later.",
  LockNotEnded: "The lock period hasn't ended yet.",
  NotTokenOwner: "You don't hold this guardian.",
  LevelNotAvailable: "That level isn't open for this tier.",
  InvalidLevel: "That level doesn't exist.",
  LevelNotPriced: "That level has no fee set yet.",
  LockEnded: "This lock has ended. Renew it to pick a new level.",
  AmountBelowLocked: "The new total can't be less than what's already locked.",
  EnforcedPause: "The Keep is paused. New locks and level-ups are on hold; claims and unlocking still work.",
  TokenNotSet: "The token hasn't been set yet.",
  ExceedsSurplus: "That would touch rewards reserved for holders.",
  RarityIsLocked: "Rarity is locked forever.",
  InvalidTierConfig: "Level settings must climb: level 1 free, caps and fees never going down, no gaps.",
  OwnableUnauthorizedAccount: "Only the owner can do this.",
  ERC20InsufficientBalance: "Not enough tokens.",
  ERC20InsufficientAllowance: "Token allowance too low.",
  AlreadyLocked: "This guardian is already locked.",
};

/** OpenSea's transfer validator on the VYRA collection: the Keep contract isn't on its allow-list yet. */
const COLLECTION_BLOCKED = "0x1de5204e";
const COLLECTION_BLOCKED_MSG =
  "The VYRA collection hasn't allowed the Keep contract to hold guardians yet. Nothing was sent. Try again once the collection owner has enabled it.";

export function errorMessage(e: unknown): string {
  const raw = e instanceof BaseError ? `${e.message} ${e.details ?? ""}` : String(e);
  if (raw.toLowerCase().includes(COLLECTION_BLOCKED)) return COLLECTION_BLOCKED_MSG;
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && FRIENDLY[name]) return FRIENDLY[name];
      if (name) return name;
    }
    if (/user rejected|denied/i.test(e.message)) return "Rejected in wallet.";
    if (/insufficient funds/i.test(e.message)) return "Not enough ETH on Ink for gas.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Dry-run a contract write, send it, wait for the receipt, toast the outcome, refresh all reads.
 * The dry run catches reverts before the wallet opens, so users see a plain reason instead of
 * the wallet's generic "simulation failed".
 */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const { chainId, address: account } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(
    label: string,
    request: Parameters<typeof writeContractAsync>[0],
    opts: { onError?: (message: string) => void } = {},
  ): Promise<boolean> {
    setBusy(label);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      await client!.simulateContract({ ...(request as { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[] }), account });
      const hash = await writeContractAsync(request);
      push({ kind: "info", title: `${label}…`, body: "Waiting for confirmation.", hash });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      push({ kind: "success", title: `${label} confirmed`, hash });
      // Ink's RPC is load-balanced, so a read right after the receipt can land on a node that
      // hasn't seen the block yet. Wait for it, refresh, then refresh again as a safety net.
      for (let i = 0; i < 10 && (await client!.getBlockNumber({ cacheTime: 0 })) < receipt.blockNumber; i++) {
        await new Promise((r) => setTimeout(r, 400));
      }
      await qc.invalidateQueries();
      for (const ms of [2_500, 7_000]) setTimeout(() => void qc.invalidateQueries(), ms);
      return true;
    } catch (e) {
      const message = errorMessage(e);
      push({ kind: "error", title: `${label} failed`, body: message });
      opts.onError?.(message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { send, busy };
}
