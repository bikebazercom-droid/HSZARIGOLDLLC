import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      mobile: usersTable.mobile,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);

  res.json(users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })));
});

router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { fullName, mobile, pin, role } = req.body as {
    fullName?: string;
    mobile?: string;
    pin?: string;
    role?: string;
  };

  if (!fullName || !mobile || !pin) {
    res.status(400).json({ error: "Full name, mobile and PIN are required" });
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  const normalizedMobile = mobile.trim().replace(/\s+/g, "");

  const username = `${normalizedMobile}_${role === "admin" ? "admin" : "staff"}`;
  const pinHash = await bcrypt.hash(pin, 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      mobile: normalizedMobile,
      passwordHash: pinHash,
      fullName: fullName.trim(),
      role: role === "admin" ? "admin" : "staff",
      isActive: true,
    })
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      mobile: usersTable.mobile,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    });

  broadcast("USER_MUTATION");
  res.status(201).json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.put("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const { fullName, mobile, pin, isActive, role } = req.body as {
    fullName?: string;
    mobile?: string;
    pin?: string;
    isActive?: boolean;
    role?: string;
  };

  if (pin && !/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (fullName !== undefined) updates.fullName = fullName.trim();
  if (mobile !== undefined) updates.mobile = mobile.trim().replace(/\s+/g, "");
  if (isActive !== undefined) updates.isActive = isActive;
  if (role !== undefined) updates.role = role === "admin" ? "admin" : "staff";
  if (pin) updates.passwordHash = await bcrypt.hash(pin, 10);

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      mobile: usersTable.mobile,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  broadcast("USER_MUTATION");
  res.json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);

  if (id === req.session.userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  broadcast("USER_MUTATION");
  res.sendStatus(204);
});

export default router;
