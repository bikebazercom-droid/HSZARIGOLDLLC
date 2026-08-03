import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, FileText, Package,
  Settings, LogOut, Menu, X, FilePlus,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ADMIN_SETTINGS_SUB = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/products", label: "Products", icon: Package },
  { href: "/settings", label: "Settings", icon: Settings },
];

const STAFF_NAV = [
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/invoices/new", label: "New Invoice", icon: FilePlus },
];

const ADMIN_BOTTOM_NAV = [
  { href: "/invoices/new", label: "New Invoice", icon: FilePlus },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsManualOpen, setSettingsManualOpen] = useState(false);

  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

  const logoType = settings?.logoType ?? "monogram";
  const logoInitial = settings?.logoInitial ?? "H";
  const logoImageUrl = settings?.logoImageUrl ?? "";
  const companyName = settings?.companyName ?? "Hazari Gold L.L.C";

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    if (href === "/invoices") {
      return location === "/invoices" ||
        (location.startsWith("/invoices/") && !location.startsWith("/invoices/new"));
    }
    return location === href || location.startsWith(href + "/");
  };

  const isNewInvoiceActive = location === "/invoices/new";
  const isSubActive = ADMIN_SETTINGS_SUB.some(i => isActive(i.href));
  const settingsOpen = settingsManualOpen || isSubActive;

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

  const AdminNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-1.5">
      {/* New Invoice — primary CTA */}
      <Link href="/invoices/new" onClick={onNavigate}>
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer font-semibold text-sm"
          style={
            isNewInvoiceActive
              ? { backgroundColor: "#c8a43a", color: "#1e3a5f" }
              : { backgroundColor: "rgba(200,164,58,0.12)", color: "#c8a43a" }
          }
        >
          <FilePlus className="w-5 h-5" />
          New Invoice
        </div>
      </Link>

      {/* Settings collapsible group */}
      <div>
        <button
          onClick={() => setSettingsManualOpen(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-md transition-colors cursor-pointer text-sm ${
            isSubActive
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "hover:bg-sidebar-accent"
          }`}
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5" />
            <span className="font-medium">Settings</span>
          </div>
          {settingsOpen
            ? <ChevronDown className="w-4 h-4 opacity-60" />
            : <ChevronRight className="w-4 h-4 opacity-60" />
          }
        </button>

        {settingsOpen && (
          <div className="mt-1 ml-3 pl-3 border-l border-sidebar-border/50 space-y-0.5">
            {ADMIN_SETTINGS_SUB.map(item => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} onClick={onNavigate}>
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm ${
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      : "hover:bg-sidebar-accent"
                  }`}>
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}

            {/* Admin profile + sign-out inside the Settings group */}
            <div className="pt-2 mt-1 border-t border-sidebar-border/40 space-y-1">
              {user && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
                  >
                    {user.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate leading-tight">{user.fullName}</div>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 mt-0.5">
                      {user.role === "admin" ? "Admin" : "Staff"}
                    </Badge>
                  </div>
                </div>
              )}
              <button
                onClick={() => { onNavigate?.(); logout(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm hover:bg-sidebar-accent text-[#DFB15B] hover:text-[#f0cc7a]"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );

  const StaffNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-1">
      {STAFF_NAV.map(item => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate}>
            <div className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer text-sm ${
              active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
            }`}>
              <Icon className="w-5 h-5" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );

  const UserFooter = ({ onLogout }: { onLogout: () => void }) => (
    <div className="mt-4 pt-4 border-t border-sidebar-border space-y-2">
      {user && (
        <div className="px-2 flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
          >
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
        onClick={onLogout}
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">

      {/* ── MOBILE TOP HEADER ── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar text-sidebar-foreground no-print" style={{ minHeight: 56 }}>
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
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
        </Link>
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
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
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

            {user?.role === "admin"
              ? <AdminNav onNavigate={() => setDrawerOpen(false)} />
              : <>
                  <StaffNav onNavigate={() => setDrawerOpen(false)} />
                  <UserFooter onLogout={() => { setDrawerOpen(false); logout(); }} />
                </>
            }
          </aside>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ── */}
      <aside className="hidden md:flex md:w-60 bg-sidebar text-sidebar-foreground p-5 flex-col no-print">
        <Link href="/">
          <div className="mb-8 flex items-center gap-3 cursor-pointer">
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
        </Link>

        {user?.role === "admin"
          ? <AdminNav />
          : <>
              <StaffNav />
              <UserFooter onLogout={logout} />
            </>
        }
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        {children}
      </main>

    </div>
  );
}
