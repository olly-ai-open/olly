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
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  const activeCls = isActive
    ? "bg-primary text-primary-foreground rounded-lg"
    : "";
  return (
    <Link href={href} className={`${className ?? ""} ${activeCls}`.trim()}>
      {children}
    </Link>
  );
}
