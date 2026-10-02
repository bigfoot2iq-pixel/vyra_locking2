"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";

// Loaded only after access is confirmed, so regular visitors never download the Council UI.
const Council = dynamic(() => import("./Council").then((m) => m.Council), { ssr: false });

// Wallets reconnect shortly after page load; wait before deciding the visitor isn't the owner.
const RECONNECT_GRACE_MS = 1500;

export function AdminGate() {
  const { allowed, loading } = useAdminAccess();
  const router = useRouter();

  useEffect(() => {
    if (allowed || loading) return;
    const id = setTimeout(() => router.replace("/"), RECONNECT_GRACE_MS);
    return () => clearTimeout(id);
  }, [allowed, loading, router]);

  return allowed ? <Council /> : null;
}
