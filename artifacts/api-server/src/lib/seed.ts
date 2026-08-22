import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function seedAdminUser(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .limit(1);

  if (existing.length > 0) {
    // Never overwrite an existing administrator's credentials at startup.
    return;
  }

  const mobile = process.env.INITIAL_ADMIN_MOBILE;
  const fullName = process.env.INITIAL_ADMIN_FULL_NAME || "Administrator";
  const pin = process.env.INITIAL_ADMIN_PIN;

  if (!mobile || !pin) {
    if (isProduction) {
      throw new Error(
        "INITIAL_ADMIN_MOBILE and INITIAL_ADMIN_PIN are required to create the first production administrator.",
      );
    }

    logger.warn(
      "No admin exists and INITIAL_ADMIN_MOBILE/INITIAL_ADMIN_PIN were not provided; skipping development admin creation.",
    );
    return;
  }

  const pinHash = await bcrypt.hash(pin, 10);
  await db.insert(usersTable).values({
    username: "admin",
    mobile,
    passwordHash: pinHash,
    fullName,
    role: "admin",
    isActive: true,
  });
  logger.info({ mobile }, "Initial admin created");
}
