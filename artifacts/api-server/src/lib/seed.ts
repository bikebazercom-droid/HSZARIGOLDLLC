import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function seedAdminUser(): Promise<void> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .limit(1);

  if (existing.length === 0) {
    const pinHash = await bcrypt.hash("1234", 10);
    await db.insert(usersTable).values({
      username: "admin",
      mobile: "0000000000",
      passwordHash: pinHash,
      fullName: "Administrator",
      role: "admin",
      isActive: true,
    });
    logger.info("Default admin created — mobile: 0000000000, PIN: 1234");
  }
}
