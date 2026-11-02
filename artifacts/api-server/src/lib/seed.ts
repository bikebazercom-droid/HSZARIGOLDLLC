import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  decideExistingAdminSeedAction,
  isFourDigitPin,
  normalizeMobile,
  pinMatchesHash,
} from "./authCredentials.js";

export async function seedAdminUser(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .limit(1);

  const configuredMobile = process.env.INITIAL_ADMIN_MOBILE;
  const mobile = configuredMobile ? normalizeMobile(configuredMobile) : "";
  const fullName = process.env.INITIAL_ADMIN_FULL_NAME || "Administrator";
  const pin = process.env.INITIAL_ADMIN_PIN;
  const resetRequested = process.env.INITIAL_ADMIN_RESET_EXISTING === "true";

  if (existing) {
    if (!mobile || !isFourDigitPin(pin)) {
      logger.info(
        "Bootstrap admin already exists; initial-admin values are incomplete, leaving the existing account unchanged.",
      );
      return;
    }

    const pinMatches = await pinMatchesHash(pin, existing.passwordHash);
    const identityMatches =
      normalizeMobile(existing.mobile) === mobile &&
      existing.fullName.trim() === fullName.trim() &&
      existing.role === "admin" &&
      existing.isActive;
    const action = decideExistingAdminSeedAction(
      pinMatches && identityMatches,
      resetRequested,
    );

    if (action === "unchanged") {
      logger.info("Bootstrap admin exists and its configured login credentials match.");
      return;
    }

    if (action === "preserve") {
      logger.warn(
        "Bootstrap admin exists but does not match the configured initial credentials; existing credentials were preserved. Set INITIAL_ADMIN_RESET_EXISTING=true for an intentional one-time reset.",
      );
      return;
    }

    await db
      .update(usersTable)
      .set({
        mobile,
        fullName: fullName.trim(),
        passwordHash: await bcrypt.hash(pin, 10),
        role: "admin",
        isActive: true,
      })
      .where(eq(usersTable.id, existing.id));
    logger.warn(
      "Existing bootstrap admin credentials were reset from the initial-admin settings; remove INITIAL_ADMIN_RESET_EXISTING after this startup.",
    );
    return;
  }

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

  if (!isFourDigitPin(pin)) {
    throw new Error("INITIAL_ADMIN_PIN must contain exactly four digits.");
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
  logger.info("Initial admin created.");
}
