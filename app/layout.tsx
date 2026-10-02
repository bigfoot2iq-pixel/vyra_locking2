import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, JetBrains_Mono, Manrope } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { Providers } from "./providers";
import "./globals.css";

const display = Cinzel({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const lore = Cormorant_Garamond({
  variable: "--font-lore",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["italic", "normal"],
});
const body = Manrope({ variable: "--font-body", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "VYRA · The Keep",
  description: "Lock your VYRA guardian, keep the vigil, claim your tribute. On Ink.",
  icons: { icon: "/vyra/logo.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${lore.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <div className="atmosphere" aria-hidden />
          <SiteHeader />
          <main className="shell">{children}</main>
          <footer className="site-footer">
            <span className="gem-sm" aria-hidden /> Same sigil, never the same guardian twice.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
