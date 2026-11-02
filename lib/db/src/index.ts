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
  const connectionString = process.env.DATABASE_URL!;
  const caCertificate = process.env.DATABASE_SSL_CA
    ?.replace(/\\n/g, "\n")
    .trim();
  const rejectUnauthorized =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

  if (!caCertificate && rejectUnauthorized) {
    return { connectionString };
  }

  if (
    caCertificate &&
    !caCertificate.includes("-----BEGIN CERTIFICATE-----")
  ) {
    throw new Error("DATABASE_SSL_CA must contain a PEM CA certificate.");
  }

  // pg-connection-string can replace PoolConfig.ssl when sslmode or related
  // options are present in DATABASE_URL. Remove those URL options so the
  // explicit TLS settings below take effect.
  const url = new URL(connectionString);
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

  if (!rejectUnauthorized) {
    console.warn(
      "[database] DATABASE_SSL_REJECT_UNAUTHORIZED=false disables TLS certificate verification; configure DATABASE_SSL_CA and remove this override.",
    );
  }

  return {
    connectionString: url.toString(),
    ssl: {
      ...(caCertificate ? { ca: caCertificate } : {}),
      rejectUnauthorized,
    },
  };
}

export const pool = new Pool(createPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
