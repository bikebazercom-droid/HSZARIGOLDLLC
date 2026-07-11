import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "./logger.js";

// Singleton Socket.IO server — initialised once from index.ts and then
// imported via broadcast() / getIO() from any route file.
let _io: Server | null = null;

export function initSocketIO(httpServer: HttpServer): Server {
  _io = new Server(httpServer, {
    // Serve the Socket.IO handshake under /api/socket.io so that the
    // Replit reverse-proxy (which routes /api/* to this service) forwards
    // both HTTP-polling and WebSocket-upgrade requests correctly.
    path: "/api/socket.io",
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
  });

  _io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "[ws] admin client connected");
    socket.on("disconnect", (reason: string) => {
      logger.info({ socketId: socket.id, reason }, "[ws] admin client disconnected");
    });
  });

  return _io;
}

/**
 * Broadcast an event to every connected admin client.
 * Safe to call before initSocketIO — silently no-ops if the server is not
 * ready yet (should never happen in practice).
 */
export function broadcast(event: string, payload?: unknown): void {
  if (!_io) return;
  _io.emit(event, payload ?? null);
}
