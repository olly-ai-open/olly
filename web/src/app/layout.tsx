import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import Script from "next/script";
import Header from "@/components/header";
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
        <Suspense
          fallback={
            <header className="border-b border-border bg-card/70 backdrop-blur">
              <div className="container mx-auto flex items-center justify-between px-4 py-3">
                <div className="font-semibold text-lg text-primary">Olly</div>
                <div className="h-8 w-20 rounded bg-border animate-pulse" />
              </div>
            </header>
          }
        >
          <Header />
        </Suspense>
        <div className="min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
