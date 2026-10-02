"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { DevAutoConnect } from "@/components/DevAutoConnect";
import { CeremonyProvider } from "@/components/fx/Ceremony";
import { Toaster } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";

const base = darkTheme({ accentColor: "#8b5cf6", accentColorForeground: "#fff", borderRadius: "small" });
const keepTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    modalBackground: "#140c24",
    modalBorder: "#372a52",
    profileForeground: "#140c24",
    connectButtonBackground: "#160e29",
    generalBorder: "#372a52",
    menuItemBackground: "#221638",
  },
  fonts: { body: "var(--font-body), system-ui, sans-serif" },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={keepTheme} modalSize="compact">
          <Toaster>
            <CeremonyProvider>
              <DevAutoConnect />
              {children}
            </CeremonyProvider>
          </Toaster>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
