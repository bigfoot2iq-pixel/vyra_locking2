"use client";

import { useEffect, useState } from "react";
import { useBlock } from "wagmi";

/**
 * Seconds on the chain's clock, ticking locally. Anchored to the latest block timestamp so it
 * stays correct on forks/local chains whose time has been warped.
 */
export function useChainNow(): number {
  const { data: block, dataUpdatedAt } = useBlock({ watch: true });
  const [wall, setWall] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!block) return Math.floor(wall / 1000);
  const elapsed = Math.max(0, (wall - dataUpdatedAt) / 1000);
  return Math.floor(Number(block.timestamp) + elapsed);
}
