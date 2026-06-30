import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { mobile, pin, role } = req.body as {
    mobile?: string;
    pin?: string;
    role?: string;
  };

  if (!mobile || !pin || !role) {
    res.status(400).json({ error: "Mobile, PIN and role are required" });
    return;
  }

  const normalizedMobile = mobile.trim().replace(/\s+/g, "");
  const normalizedRole = role === "admin" ? "admin" : "staff";

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.mobile, normalizedMobile),
        eq(usersTable.role, normalizedRole),
        eq(usersTable.isActive, true)
      )
    )
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(pin, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid PIN" });
    return;
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.fullName = user.fullName;
  req.session.role = user.role as "admin" | "staff";

  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mobile: user.mobile,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      role: usersTable.role,
      mobile: usersTable.mobile,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId!))
    .limit(1);

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(user);
});

export default router;
