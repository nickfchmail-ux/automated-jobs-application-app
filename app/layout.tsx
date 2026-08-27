import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Instrument_Serif,
  Manrope,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./theme-provider";
import { themeInitScript } from "./theme-init";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for headings + headline numbers — professional, warm,
// geometric. Loaded once at build (self-hosted, no runtime fetch).
const manrope = Manrope({
  variable: "--font-display",
  subsets: ["latin"],
});

// Editorial serif for the signature headline figures (the "match rate" /
// "strength" numbers) — the one memorable type moment.
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  subsets: ["latin"],
});

// Data / scores use a precise mono face (Stripe's data-typography feel).
const plexMono = IBM_Plex_Mono({
  variable: "--font-data",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "JobSeek",
    template: "%s | JobSeek",
  },
  description: "Smart Careers, Simplified by AI.",
  icons: {
    icon: "/JobSeek.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${instrumentSerif.variable} ${plexMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
