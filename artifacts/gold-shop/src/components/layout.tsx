import React from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, FileText, Package, DollarSign, Settings, LogOut } from "lucide-react";
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

  const logoInitial = settings?.logoInitial ?? "H";
  const logoType = settings?.logoType ?? "monogram";
  const logoImageUrl = settings?.logoImageUrl ?? "";
  const companyName = settings?.companyName ?? "Hazari Gold L.L.C";

  const navItems = user?.role === "admin" ? ADMIN_NAV : STAFF_NAV;

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-sidebar text-sidebar-foreground p-6 flex flex-col no-print">
        <div className="mb-8 flex items-center gap-3">
          {logoType === "image" && logoImageUrl ? (
            <div className="w-10 h-10 rounded flex-shrink-0 overflow-hidden bg-white flex items-center justify-center p-0.5">
              <img src={logoImageUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
          ) : logoType === "monogram" ? (
            <div className="w-10 h-10 rounded flex items-center justify-center text-white font-bold text-lg flex-shrink-0" style={{ backgroundColor: "#1e3a5f" }}>
              <span style={{ color: "#c8a43a", fontFamily: "serif", fontSize: "1.1rem" }}>{logoInitial}</span>
            </div>
          ) : null}
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
                <div
                  className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors cursor-pointer ${
                    active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
                  }`}
                >
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
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
