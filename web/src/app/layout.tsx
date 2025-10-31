import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import Script from "next/script";
import NavAuth from "@/components/nav-auth";
import ThemeToggle from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Olly",
  description: "Your Chief of Staff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var d=(t==='dark')||((t==='system'||!t)&&m&&m.matches);var r=document.documentElement;d?r.classList.add('dark'):r.classList.remove('dark');}catch(e){}})();`}
        </Script>
        <header className="border-b border-border bg-card/70 backdrop-blur">
          <div className="container mx-auto grid grid-cols-2 items-center px-4 py-3">
            <Link href="/" className="font-semibold text-lg text-primary">
              Olly
            </Link>
            <div className="flex items-center justify-self-end gap-3">
              <ThemeToggle />
              <Suspense
                fallback={<div className="h-5 w-24 rounded bg-border" />}
              >
                <NavAuth />
              </Suspense>
            </div>
          </div>
        </header>
        <div className="min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
