"use client";

import { parseAbi, type Address } from "viem";
import { useAccount, useBytecode, useReadContract } from "wagmi";
import { vyraLockingAbi } from "@/lib/abis";
import { addresses } from "@/lib/env";

const safeAbi = parseAbi(["function isOwner(address owner) view returns (bool)"]);

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Who may see the Council (admin) UI: the locking contract's owner, or — when that owner is a
 * Safe — any of the Safe's signers. UI gating only; the contracts enforce onlyOwner themselves.
 */
export function useAdminAccess() {
  const { address, status } = useAccount();

  const owner = useReadContract({
    address: addresses.locking,
    abi: vyraLockingAbi,
    functionName: "owner",
    query: { enabled: !!addresses.locking },
  });
  const ownerAddr = owner.data as Address | undefined;

  const code = useBytecode({ address: ownerAddr, query: { enabled: !!ownerAddr } });
  const ownerIsContract = !!code.data && code.data !== "0x";

  const signer = useReadContract({
    address: ownerAddr,
    abi: safeAbi,
    functionName: "isOwner",
    args: address ? [address] : undefined,
    query: { enabled: ownerIsContract && !!address },
  });

  const isOwner = same(address, ownerAddr);
  const isSafeSigner = ownerIsContract && signer.data === true;
  const loading =
    status === "connecting" ||
    status === "reconnecting" ||
    (!!address && (owner.isLoading || (!!ownerAddr && code.isLoading) || (ownerIsContract && signer.isLoading)));

  return { allowed: isOwner || isSafeSigner, isOwner, isSafeSigner, loading, owner: ownerAddr };
}
