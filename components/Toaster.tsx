"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { explorerUrl } from "@/lib/env";

type Kind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
  hash?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => void;
}

const ToastCtx = createContext<ToastApi>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

let seq = 0;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "error" ? 9000 : 6000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-gem" aria-hidden />
            <div>
              <p className="toast-title">{t.title}</p>
              {t.body && <p className="toast-body">{t.body}</p>}
              {t.hash && explorerUrl && (
                <a className="toast-link" href={`${explorerUrl}/tx/${t.hash}`} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
