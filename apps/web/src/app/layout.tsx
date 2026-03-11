import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import Script from "next/script";
import Image from "next/image";
import Header from "@/components/layout/header";
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-dvh flex flex-col`}
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
        <main className="flex-1">{children}</main>
        <div className="pointer-events-none fixed bottom-4 right-4 z-40 hidden sm:block opacity-90 drop-shadow-lg">
          <Image
            src="/olly-mascot.png"
            alt="Olly mascot"
            width={64}
            height={64}
            className="h-16 w-16 rounded-full bg-card/90 p-1 shadow-card"
            priority
          />
        </div>
      </body>
    </html>
  );
}
