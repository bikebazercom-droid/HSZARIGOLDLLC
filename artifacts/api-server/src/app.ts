import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { PostgresSessionStore } from "./lib/postgresSessionStore";

const app: Express = express();
const isProduction = process.env.NODE_ENV === "production";
const staticDir = process.env.STATIC_DIR;
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET is required when NODE_ENV=production.");
}

if (isProduction) {
  // Hostinger terminates HTTPS at its proxy. Trust the first proxy so secure
  // production session cookies work correctly at the public domain.
  app.set("trust proxy", 1);
}

// Live gold pricing endpoints must never be served from a conditional-GET
// (ETag) cache — the TV board and dashboard poll every second and require
// the freshest tick every time, even if the body happens to be byte-identical
// to the previous response.
app.disable("etag");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use(
  session({
    secret: sessionSecret || "hazari-gold-secret-key",
    store: isProduction ? new PostgresSessionStore() : undefined,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Lax blocks cross-site cookie sends on non-GET requests (CSRF baseline);
      // the app is served same-origin behind the hosting proxy, so this is safe.
      sameSite: "lax",
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);

  // In the Hostinger bundle, the same Node process serves the compiled React
  // app and its API. Static assets are served directly; client-side routes
  // fall back to index.html while /api remains an API-only namespace.
  app.use(express.static(resolvedStaticDir, { index: false }));
  app.use((req, res, next) => {
    if (
      (req.method !== "GET" && req.method !== "HEAD") ||
      req.path === "/api" ||
      req.path.startsWith("/api/")
    ) {
      next();
      return;
    }

    res.sendFile("index.html", { root: resolvedStaticDir });
  });
}

export default app;
