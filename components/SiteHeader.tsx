"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { activeChain } from "@/lib/env";
import { WalletButton } from "./WalletButton";

export function SiteHeader() {
  const path = usePathname();
  const { allowed: isAdmin } = useAdminAccess();

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
          <a href="https://opensea.io/collection/vyranfts/overview" target="_blank" rel="noreferrer">
            Collection
          </a>
          {isAdmin && (
            <Link href="/admin" aria-current={path === "/admin" ? "page" : undefined}>
              Council
            </Link>
          )}
        </nav>
        <span className="chain-pill">
          <span className="gem-sm gem-pulse" /> {activeChain.name}
        </span>
        <WalletButton className="btn btn-primary btn-sm" />
      </div>
    </header>
  );
}
