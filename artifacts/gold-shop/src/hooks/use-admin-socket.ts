import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/context/auth";
import {
  getListInvoicesQueryKey,
  getGetDashboardQueryKey,
  getGetMonthlySalesQueryKey,
  getGetCategorySummaryQueryKey,
  getGetPricesQueryKey,
  getGetPricesSpotQueryKey,
  getListProductsQueryKey,
  getGetSettingsQueryKey,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";

// Module-level singleton — one socket shared across all hook instances.
// This avoids opening duplicate connections when the hook is mounted in
// multiple components simultaneously.
let _socket: Socket | null = null;

function getSocket(): Socket {
  if (!_socket) {
    _socket = io({
      // Match the path configured on the server so the Replit reverse-proxy
      // (which routes /api/* to the API service) correctly forwards both
      // HTTP-polling and WebSocket-upgrade requests.
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
    });
  }
  return _socket;
}

/**
 * Subscribes to real-time mutation broadcasts from the API server and
 * invalidates the relevant React Query caches so every connected admin
 * session stays in sync without a manual refresh.
 *
 * Safe to call in a form — React Query invalidation only triggers a
 * background re-fetch; it never wipes local component state or active inputs.
 */
export function useAdminSocket(): void {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    // Only open the connection once the user is authenticated
    if (!user) return;

    const sock = getSocket();

    function onInvoiceMutation() {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMonthlySalesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCategorySummaryQueryKey() });
    }

    function onPriceMutation() {
      // Invalidate both the admin prices page AND the live spot endpoint so
      // every consumer (admin dashboard, prices page, live-price context) gets
      // an immediate push-driven update instead of waiting for its poll cycle.
      queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPricesSpotQueryKey() });
    }

    function onProductMutation() {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    }

    function onSettingsMutation() {
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPublicSettingsQueryKey() });
    }

    sock.on("INVOICE_MUTATION",  onInvoiceMutation);
    sock.on("PRICE_MUTATION",    onPriceMutation);
    sock.on("PRODUCT_MUTATION",  onProductMutation);
    sock.on("SETTINGS_MUTATION", onSettingsMutation);

    return () => {
      sock.off("INVOICE_MUTATION",  onInvoiceMutation);
      sock.off("PRICE_MUTATION",    onPriceMutation);
      sock.off("PRODUCT_MUTATION",  onProductMutation);
      sock.off("SETTINGS_MUTATION", onSettingsMutation);
    };
  }, [user, queryClient]);
}
