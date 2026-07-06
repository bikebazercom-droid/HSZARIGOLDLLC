import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/auth";
import { AppLayout } from "@/components/layout";
import { emitSessionExpired } from "@/lib/session-events";

import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Invoices from "@/pages/invoices/index";
import NewInvoice from "@/pages/invoices/new";
import InvoiceDetail from "@/pages/invoices/[id]";
import Customers from "@/pages/customers/index";
import NewCustomer from "@/pages/customers/new";
import CustomerDetail from "@/pages/customers/[id]";
import Products from "@/pages/products/index";
import NewProduct from "@/pages/products/new";
import ProductDetail from "@/pages/products/[id]";
import Prices from "@/pages/prices";
import SettingsPage from "@/pages/settings";
import ShowroomBoard from "@/pages/showroom-board";
import NotFound from "@/pages/not-found";

// A 401 from any query or mutation means the server-side session is gone
// (expired, or the API server restarted and dropped its in-memory session
// store). There's no token to re-attach — bounce straight back to the login
// screen instead of leaving a form showing a raw "Unauthorized" error.
function handleQueryError(error: unknown) {
  if ((error as { status?: number } | null)?.status === 401) {
    emitSessionExpired();
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.status === 401 || error?.status === 403) return false;
        return failureCount < 2;
      },
    },
  },
  queryCache: new QueryCache({ onError: handleQueryError }),
  mutationCache: new MutationCache({ onError: handleQueryError }),
});

function StaffRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/new" component={NewInvoice} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route>{() => <Redirect to="/invoices" />}</Route>
      </Switch>
    </AppLayout>
  );
}

function AdminRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/new" component={NewInvoice} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/new" component={NewCustomer} />
        <Route path="/customers/:id" component={CustomerDetail} />
        <Route path="/products" component={Products} />
        <Route path="/products/new" component={NewProduct} />
        <Route path="/products/:id" component={ProductDetail} />
        <Route path="/prices" component={Prices} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1e3a5f" }}>
        <div className="text-white text-center space-y-3">
          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-xl font-bold" style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}>H</div>
          <p className="text-blue-200 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  if (user.role === "admin") return <AdminRouter />;
  return <StaffRouter />;
}

// Public, unauthenticated routes — matched before the auth gate so they never
// require a login session (e.g. an always-on showroom TV display).
function PublicRouter() {
  return (
    <Switch>
      <Route path="/tv" component={ShowroomBoard} />
      <Route>{() => <AuthGate />}</Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <PublicRouter />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
