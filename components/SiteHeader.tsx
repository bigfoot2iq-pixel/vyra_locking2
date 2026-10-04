"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useProtocol } from "@/hooks/useProtocol";
import { activeChain, buyUrlFor } from "@/lib/env";
import { WalletButton } from "./WalletButton";

export function SiteHeader() {
  const path = usePathname();
  const { allowed: isAdmin } = useAdminAccess();
  const p = useProtocol();
  const buy = buyUrlFor(p.token);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand">
          <Image src="/vyra/logo.png" alt="" width={38} height={38} priority />
          <span>
            <span className="brand-name">VYRA</span>
            <span className="brand-sub">THE KEEP</span>
          </span>
        </Link>
        <nav className="nav">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            The Keep
          </Link>
          {isAdmin && (
            <Link href="/admin" aria-current={path === "/admin" ? "page" : undefined}>
              Council
            </Link>
          )}
        </nav>
        <div className="market-links">
          <a
            className="market-pill market-opensea"
            href="https://opensea.io/collection/vyranfts/overview"
            target="_blank"
            rel="noreferrer"
            title="VYRA collection on OpenSea"
          >
            <Image src="/brands/opensea.png" alt="" width={22} height={22} />
            <span className="market-label">Collection</span>
          </a>
          {buy && (
            <a className="market-pill market-sentry" href={buy} target="_blank" rel="noreferrer" title={`Buy ${p.symbol} on Sentry`}>
              <Image src="/brands/sentry.png" alt="" width={22} height={22} />
              <span className="market-label">{p.token ? p.symbol : "Token"}</span>
            </a>
          )}
        </div>
        <span className="chain-pill">
          <span className="gem-sm gem-pulse" /> {activeChain.name}
        </span>
        <WalletButton className="btn btn-primary btn-sm" />
      </div>
    </header>
  );
}
