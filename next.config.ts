import type { NextConfig } from "next";

// Optional x402 payment deps imported by @coinbase/cdp-sdk (via wagmi's Base Account connector).
// Unused here, so they resolve to an empty module instead of failing the build.
const optionalStubs = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
];

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: Object.fromEntries(optionalStubs.map((m) => [m, "./lib/stubs/empty.js"])),
  },
};

export default nextConfig;
