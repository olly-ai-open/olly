"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

export default function NavLinkActive({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";
  const isActive = href === "/" ? pathname === "/" : pathname === href;
  const activeCls = isActive
    ? "bg-sidebar-accent text-sidebar-foreground shadow-card ring-1 ring-sidebar-border/70 rounded-md font-semibold"
    : "";
  return (
    <Link href={href} className={`${className ?? ""} ${activeCls}`.trim()}>
      {children}
    </Link>
  );
}
