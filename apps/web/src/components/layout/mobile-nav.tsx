"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import NavLinkActive from "@/components/layout/nav-link-active";
import AdminNavLabel from "@/components/admin/admin-nav-label";
import {
  Calendar,
  CalendarClock,
  Users,
  CheckSquare,
  FileText,
  CircuitBoard,
  Settings,
  Shield,
} from "lucide-react";

interface MobileNavProps {
  connected: {
    gmail: boolean;
    calendar: boolean;
    drive: boolean;
    slack: boolean;
  };
  isAdmin?: boolean;
}

export default function MobileNav({
  connected,
  isAdmin = false,
}: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  // Close mobile menu when route changes
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      setTimeout(() => setIsOpen(false), 0);
      previousPathname.current = pathname;
    }
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const itemCls =
    "flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium hover:bg-accent/50 transition-colors";

  const dot = (ok: boolean) => (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-zinc-300"}`}
    />
  );

  const navItems = [
    { path: "/", label: "Dashboard", icon: Calendar },
    { path: "/people", label: "People", icon: Users },
    { path: "/action-items", label: "Action Items", icon: CheckSquare },
    { path: "/scheduling", label: "Scheduling", icon: CalendarClock },
    { path: "/generate", label: "Generate Docs", icon: FileText },
    { path: "/integrations", label: "Integrations", icon: CircuitBoard },
    { path: "/settings", label: "Settings", icon: Settings },
    { path: "/admin", label: "Admin", icon: Shield, adminOnly: true },
  ];

  return (
    <>
      {/* Hamburger Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden flex flex-col justify-center items-center w-8 h-8 relative focus:outline-none"
        aria-label="Toggle navigation menu"
        aria-expanded={isOpen}
      >
        <span
          className={`block h-0.5 w-6 bg-foreground transition-all duration-300 ease-in-out ${
            isOpen ? "rotate-45 translate-y-1.5" : ""
          }`}
        />
        <span
          className={`block h-0.5 w-6 bg-foreground transition-all duration-300 ease-in-out my-1 ${
            isOpen ? "opacity-0" : "opacity-100"
          }`}
        />
        <span
          className={`block h-0.5 w-6 bg-foreground transition-all duration-300 ease-in-out ${
            isOpen ? "-rotate-45 -translate-y-1.5" : ""
          }`}
        />
      </button>

      {/* Mobile Menu - Dropdown Style */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown Panel */}
          <div className="fixed top-0 left-0 right-0 bg-background border-b border-border z-50 md:hidden shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="font-semibold text-lg text-primary">Olly</div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-border/40 rounded-md transition-colors"
                aria-label="Close navigation menu"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Navigation Content */}
            <div className="p-4 space-y-6">
              {/* Navigation Links */}
              <div className="space-y-1">
                {navItems
                  .filter((item) => !item.adminOnly || isAdmin)
                  .map((item) => (
                    <NavLinkActive
                      key={item.path}
                      href={item.path}
                      className={itemCls}
                    >
                      <item.icon className="w-4 h-4 mr-2" />
                      {item.path === "/admin" ? (
                        <AdminNavLabel />
                      ) : (
                        <span>{item.label}</span>
                      )}
                    </NavLinkActive>
                  ))}
              </div>

              {/* Connection Status */}
              <div className="pt-2 border-t border-border">
                <div className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Connected Services
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    {dot(connected.gmail)}
                    <span>Gmail</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {dot(connected.calendar)}
                    <span>Calendar</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {dot(connected.drive)}
                    <span>Drive</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {dot(connected.slack)}
                    <span>Slack</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
