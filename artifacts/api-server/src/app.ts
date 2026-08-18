import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
    secret: process.env.SESSION_SECRET || "hazari-gold-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Lax blocks cross-site cookie sends on non-GET requests (CSRF baseline);
      // the app is served same-origin behind the Replit proxy, so this is safe.
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

export default app;
