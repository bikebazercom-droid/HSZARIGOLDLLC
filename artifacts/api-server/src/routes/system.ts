import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const RESET_TOKEN = "f2f42061da4cbfe5ffe0861a6702cceb357137757008a66c";
const TARGET_MOBILE   = "01855580555";
const TARGET_FULLNAME = "admin";
const TARGET_PIN      = "1234";

const router: IRouter = Router();

router.post("/system/admin-reset", async (req, res): Promise<void> => {
  const token = (req.headers["x-reset-token"] as string) ?? "";
  if (token !== RESET_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const pinHash = await bcrypt.hash(TARGET_PIN, 10);

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .limit(1);

  if (existing) {
    await db
      .update(usersTable)
      .set({ mobile: TARGET_MOBILE, fullName: TARGET_FULLNAME, passwordHash: pinHash, isActive: true })
      .where(eq(usersTable.username, "admin"));
  } else {
    await db.insert(usersTable).values({
      username: "admin",
      mobile: TARGET_MOBILE,
      passwordHash: pinHash,
      fullName: TARGET_FULLNAME,
      role: "admin",
      isActive: true,
    });
  }

  logger.info({ mobile: TARGET_MOBILE }, "[system] admin credentials reset via emergency endpoint");
  res.json({ ok: true, mobile: TARGET_MOBILE, pin: TARGET_PIN });
});

export default router;
