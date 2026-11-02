import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolConfig } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function createPoolConfig(): PoolConfig {
  const url = new URL(process.env.DATABASE_URL!);
  const sslMode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");

  // Keep non-TLS development databases working. Production always uses TLS;
  // development URLs that request TLS use the same explicit settings below.
  if (
    process.env.NODE_ENV !== "production" &&
    (!sslMode || sslMode === "disable") &&
    (!ssl || ssl === "false")
  ) {
    return { connectionString: url.toString() };
  }

  // pg-connection-string can override PoolConfig.ssl when DATABASE_URL has
  // sslmode or related query options. Remove them so this explicit TLS config
  // is used consistently by the shared pool (including the session store).
  for (const option of [
    "ssl",
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslpassword",
    "uselibpqcompat",
    "sslnegotiation",
  ]) {
    url.searchParams.delete(option);
  }

  console.warn(
    "[database] TLS certificate verification is disabled for the PostgreSQL connection.",
  );

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  };
}

export const pool = new Pool(createPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
