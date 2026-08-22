import session, { type SessionData } from "express-session";
import { pool } from "@workspace/db";
import { logger } from "./logger";

type SessionCallback = (error?: unknown) => void;
type SessionReadCallback = (
  error: unknown,
  session?: SessionData | null,
) => void;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class PostgresSessionStore extends session.Store {
  private readonly ready: Promise<void>;
  private readonly pruneTimer: NodeJS.Timeout;

  constructor() {
    super();
    this.ready = this.initialize();
    this.pruneTimer = setInterval(() => {
      void this.pruneExpired();
    }, PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  private async initialize(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
      ON user_sessions (expire)
    `);
    await this.pruneExpired();
  }

  private async pruneExpired(): Promise<void> {
    try {
      await pool.query("DELETE FROM user_sessions WHERE expire <= NOW()");
    } catch (error) {
      logger.error({ err: error }, "Failed to prune expired sessions");
    }
  }

  get(sid: string, callback: SessionReadCallback): void {
    void this.ready
      .then(async () => {
        const result = await pool.query<{
          sess: SessionData;
          expire: Date;
        }>(
          `SELECT sess, expire
           FROM user_sessions
           WHERE sid = $1 AND expire > NOW()
           LIMIT 1`,
          [sid],
        );
        callback(null, result.rows[0]?.sess ?? null);
      })
      .catch((error) => callback(error));
  }

  set(sid: string, sessionData: SessionData, callback?: SessionCallback): void {
    const expire = sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + SESSION_TTL_MS);

    void this.ready
      .then(() =>
        pool.query(
          `INSERT INTO user_sessions (sid, sess, expire)
           VALUES ($1, $2, $3)
           ON CONFLICT (sid)
           DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
          [sid, sessionData, expire],
        ),
      )
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: SessionCallback): void {
    void this.ready
      .then(() => pool.query("DELETE FROM user_sessions WHERE sid = $1", [sid]))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sessionData: SessionData, callback?: SessionCallback): void {
    const expire = sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + SESSION_TTL_MS);

    void this.ready
      .then(() =>
        pool.query(
          "UPDATE user_sessions SET expire = $2 WHERE sid = $1",
          [sid, expire],
        ),
      )
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }
}