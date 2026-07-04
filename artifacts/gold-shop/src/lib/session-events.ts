// Tiny pub/sub so the global query client (which lives outside React) can
// notify AuthProvider when a request comes back 401. This app authenticates
// via an httpOnly session cookie (not a JWT/Bearer token) — every request
// already goes out with `credentials: "include"` (see customFetch). A 401
// here means the *server-side session itself* is gone (expired, or the
// dev server restarted and lost its in-memory session store) — there is no
// token to "attach", the user simply needs to log in again. This event lets
// the UI react to that immediately instead of surfacing a raw fetch error.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionExpired(): void {
  listeners.forEach(listener => listener());
}
