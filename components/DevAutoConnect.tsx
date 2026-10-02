"use client";

import { useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { anvil } from "viem/chains";
import { activeChain } from "@/lib/env";
import { useCeremony, type Rite } from "./fx/Ceremony";

/**
 * Local anvil only: `?dev` connects the unlocked anvil account without a browser wallet;
 * `?rite=lock|renew|levelup` previews the ceremony overlay.
 */
export function DevAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const celebrate = useCeremony();

  useEffect(() => {
    if (activeChain.id !== anvil.id) return;
    const kind = new URLSearchParams(window.location.search).get("rite") as Rite["kind"] | null;
    if (kind) celebrate({ kind, tokenId: 1n, tier: 4, level: 2, image: "/vyra/aurum.webp", days: 7 });
  }, [celebrate]);

  useEffect(() => {
    if (activeChain.id !== anvil.id || isConnected) return;
    if (!new URLSearchParams(window.location.search).has("dev")) return;
    const mock = connectors.find((c) => c.id === "mock");
    if (mock) connect({ connector: mock });
  }, [isConnected, connect, connectors]);

  return null;
}
