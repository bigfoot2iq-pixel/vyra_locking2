"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/** RainbowKit connect flow, dressed as a Keep button. */
export function WalletButton({ label = "Connect wallet", className = "btn btn-primary" }: { label?: string; className?: string }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        if (!mounted) return <button className={className} disabled aria-hidden style={{ opacity: 0 }} />;
        if (!account) {
          return (
            <button className={className} onClick={openConnectModal}>
              {label}
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button className="btn btn-gold btn-sm" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }
        return (
          <button className="btn btn-ghost btn-sm" onClick={openAccountModal}>
            <span className="gem-sm" /> {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
