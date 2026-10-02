"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
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
};

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && FRIENDLY[name]) return FRIENDLY[name];
      if (name) return name;
    }
    if (/user rejected|denied/i.test(e.message)) return "Rejected in wallet.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Send a contract write, wait for the receipt, toast the outcome, refresh all reads. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(label: string, request: Parameters<typeof writeContractAsync>[0]): Promise<boolean> {
    setBusy(label);
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const hash = await writeContractAsync(request);
      push({ kind: "info", title: `${label}…`, body: "Waiting for confirmation.", hash });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      push({ kind: "success", title: `${label} confirmed`, hash });
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      push({ kind: "error", title: `${label} failed`, body: errorMessage(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { send, busy };
}
