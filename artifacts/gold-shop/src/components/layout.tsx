import React from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, FileText, Package, DollarSign } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/invoices", label: "Invoices", icon: FileText },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/products", label: "Products", icon: Package },
    { href: "/prices", label: "Prices", icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-sidebar text-sidebar-foreground p-6 flex flex-col no-print">
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded flex items-center justify-center text-white font-bold text-lg flex-shrink-0" style={{ backgroundColor: "#1e3a5f" }}>
            <span style={{ color: "#c8a43a", fontFamily: "serif", fontSize: "1.1rem" }}>H</span>
          </div>
          <div>
            <div className="font-bold text-lg leading-tight" style={{ color: "#c8a43a" }}>Hazari Gold</div>
            <div className="text-xs text-muted-foreground leading-tight">L.L.C</div>
          </div>
        </div>
        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
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
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
