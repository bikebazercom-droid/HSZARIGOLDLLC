import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, FileText, Package,
  DollarSign, Settings, LogOut, Menu, X,
} from "lucide-react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ADMIN_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/prices", label: "Prices", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
];

const STAFF_NAV = [
  { href: "/invoices", label: "Invoices", icon: FileText },
];

const ADMIN_BOTTOM_NAV = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/prices", label: "Prices", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

  const logoType = settings?.logoType ?? "monogram";
  const logoInitial = settings?.logoInitial ?? "H";
  const logoImageUrl = settings?.logoImageUrl ?? "";
  const companyName = settings?.companyName ?? "Hazari Gold L.L.C";

  const navItems = user?.role === "admin" ? ADMIN_NAV : STAFF_NAV;
  const bottomNavItems = user?.role === "admin" ? ADMIN_BOTTOM_NAV : STAFF_NAV;

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const LogoMark = () => (
    logoType === "image" && logoImageUrl ? (
      <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden bg-white flex items-center justify-center p-0.5">
        <img src={logoImageUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
      </div>
    ) : (
      <div className="w-9 h-9 rounded flex items-center justify-center font-bold text-lg flex-shrink-0" style={{ backgroundColor: "#1e3a5f" }}>
        <span style={{ color: "#c8a43a", fontFamily: "serif" }}>{logoInitial}</span>
      </div>
    )
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">

      {/* ── MOBILE TOP HEADER ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar text-sidebar-foreground no-print" style={{ minHeight: 56 }}>
        <div className="flex items-center gap-2">
          <LogoMark />
          <div>
            <div className="font-bold text-sm leading-tight" style={{ color: "#c8a43a" }}>
              {companyName.split(" ").slice(0, 2).join(" ")}
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              {companyName.split(" ").slice(2).join(" ") || "L.L.C"}
            </div>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-md hover:bg-sidebar-accent transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
      </header>

      {/* ── MOBILE DRAWER OVERLAY ── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground flex flex-col p-6 shadow-2xl h-full">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <LogoMark />
                <div>
                  <div className="font-bold text-base leading-tight" style={{ color: "#c8a43a" }}>
                    {companyName.split(" ").slice(0, 2).join(" ")}
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight">
                    {companyName.split(" ").slice(2).join(" ") || "L.L.C"}
                  </div>
                </div>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded hover:bg-sidebar-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)}>
                    <div className={`flex items-center gap-3 px-4 py-3.5 rounded-md transition-colors cursor-pointer text-base ${
                      active ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold" : "hover:bg-sidebar-accent"
                    }`}>
                      <Icon className="w-5 h-5" />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 pt-4 border-t border-sidebar-border space-y-3">
              {user && (
                <div className="px-2 flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}>
                    {user.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{user.fullName}</div>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                      {user.role === "admin" ? "Admin" : "Staff"}
                    </Badge>
                  </div>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-[#DFB15B] hover:text-[#f0cc7a] hover:bg-sidebar-accent transition-colors"
                onClick={() => { setDrawerOpen(false); logout(); }}
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ── */}
      <aside className="hidden md:flex md:w-64 bg-sidebar text-sidebar-foreground p-6 flex-col no-print">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <div>
            <div className="font-bold text-base leading-tight" style={{ color: "#c8a43a" }}>
              {companyName.split(" ").slice(0, 2).join(" ")}
            </div>
            <div className="text-xs text-muted-foreground leading-tight">
              {companyName.split(" ").slice(2).join(" ") || "L.L.C"}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer ${
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
                }`}>
                  <Icon className="w-5 h-5" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 pt-4 border-t border-sidebar-border space-y-3">
          {user && (
            <div className="px-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}>
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{user.fullName}</div>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    {user.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                </div>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-[#DFB15B] hover:text-[#f0cc7a] hover:bg-sidebar-accent transition-colors"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 md:pb-6">
        {children}
      </main>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-sidebar text-sidebar-foreground border-t border-sidebar-border no-print z-40"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className="flex flex-col items-center justify-center py-2 px-1 min-w-0 transition-colors"
                  style={{ width: `${100 / bottomNavItems.length}vw` }}>
                  <Icon className="w-5 h-5 mb-0.5" style={{ color: active ? "#c8a43a" : undefined }} />
                  <span className="text-[10px] leading-none font-medium truncate"
                    style={{ color: active ? "#c8a43a" : undefined }}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
