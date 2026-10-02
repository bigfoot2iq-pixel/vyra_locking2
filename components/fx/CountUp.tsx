"use client";

import { formatUnits } from "viem";
import { useCountUp } from "@/hooks/useCountUp";

export function CountUp({ value, decimals = 18, maxFrac = 2 }: { value: bigint | number | undefined; decimals?: number; maxFrac?: number }) {
  const target = value === undefined ? 0 : typeof value === "bigint" ? Number(formatUnits(value, decimals)) : value;
  const shown = useCountUp(target);
  if (value === undefined) return <>—</>;
  return <>{shown.toLocaleString("en-US", { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 })}</>;
}
