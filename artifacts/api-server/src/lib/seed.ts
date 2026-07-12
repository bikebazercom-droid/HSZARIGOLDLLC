import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const TARGET_MOBILE   = "01855580555";
const TARGET_FULLNAME = "admin";
const TARGET_PIN      = "1234";

export async function seedAdminUser(): Promise<void> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .limit(1);

  if (existing.length === 0) {
    const pinHash = await bcrypt.hash(TARGET_PIN, 10);
    await db.insert(usersTable).values({
      username:     "admin",
      mobile:       TARGET_MOBILE,
      passwordHash: pinHash,
      fullName:     TARGET_FULLNAME,
      role:         "admin",
      isActive:     true,
    });
    logger.info({ mobile: TARGET_MOBILE }, "Default admin created");
    return;
  }

  const admin = existing[0];

  // If the stored credentials don't match our target, do a full reset
  // so the admin can always log in with the canonical mobile + PIN.
  if (admin.mobile !== TARGET_MOBILE || admin.fullName !== TARGET_FULLNAME) {
    const pinHash = await bcrypt.hash(TARGET_PIN, 10);
    await db
      .update(usersTable)
      .set({
        mobile:       TARGET_MOBILE,
        fullName:     TARGET_FULLNAME,
        passwordHash: pinHash,
        isActive:     true,
      })
      .where(eq(usersTable.username, "admin"));
    logger.info(
      { mobile: TARGET_MOBILE, fullName: TARGET_FULLNAME },
      "Admin credentials fully reset to target (mobile + PIN)",
    );
  }
}
