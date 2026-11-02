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

  if (!caCertificate) {
    return { connectionString };
  }

  if (!caCertificate.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA must contain a PEM CA certificate.");
  }

  // pg-connection-string can replace PoolConfig.ssl when sslmode or related
  // options are present in DATABASE_URL. Remove those URL options so the
  // explicit Supabase CA is used and certificate verification remains enabled.
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

  return {
    connectionString: url.toString(),
    ssl: {
      ca: caCertificate,
      rejectUnauthorized: true,
    },
  };
}

export const pool = new Pool(createPoolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
