import { Heebo, Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { LocaleProvider } from "../components/LocaleProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { LOCALE_ANTI_FLASH_SCRIPT } from "../lib/i18n/locale-anti-flash-script";
import { THEME_ANTI_FLASH_SCRIPT } from "../lib/theme-anti-flash-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Inter has no Hebrew glyphs. Heebo covers both Latin and Hebrew, so Hebrew
// mode gets a real, purpose-designed typeface instead of silently falling
// back to whatever the OS happens to ship - see globals.css's
// `:root[dir="rtl"] { --font-sans: ... }` override.
const heebo = Heebo({ subsets: ["latin", "hebrew"], variable: "--font-heebo", display: "swap" });

export const metadata: Metadata = {
  title: "DYO Operations Dashboard",
  description: "Read-only monitoring for the DYO After Effects automation control plane."
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" dir="ltr" className={`${inter.variable} ${heebo.variable}`}>
      <head>
        {/* Blocking by design - must run before first paint so the correct
            theme is applied immediately, never a flash of the wrong one.
            Reads only its own namespaced localStorage key/matchMedia,
            writes only a DOM attribute - see theme-anti-flash-script.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_ANTI_FLASH_SCRIPT }} />
        {/* Same pattern, for lang/dir - a flash of LTR English before
            hydration would be far more jarring for an RTL visitor than the
            theme case (reading direction and font both change, not just
            colors) - see locale-anti-flash-script.ts. */}
        <script dangerouslySetInnerHTML={{ __html: LOCALE_ANTI_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
