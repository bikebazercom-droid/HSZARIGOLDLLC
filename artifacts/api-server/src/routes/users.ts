import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);

  res.json(users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })));
});

router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { username, password, fullName, role } = req.body as {
    username?: string;
    password?: string;
    fullName?: string;
    role?: string;
  };

  if (!username || !password || !fullName) {
    res.status(400).json({ error: "username, password and fullName are required" });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, normalizedUsername))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      username: normalizedUsername,
      passwordHash,
      fullName: fullName.trim(),
      role: role === "admin" ? "admin" : "staff",
      isActive: true,
    })
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    });

  res.status(201).json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.put("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const { fullName, password, isActive, role } = req.body as {
    fullName?: string;
    password?: string;
    isActive?: boolean;
    role?: string;
  };

  const updates: Record<string, unknown> = {};
  if (fullName !== undefined) updates.fullName = fullName.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (role !== undefined) updates.role = role === "admin" ? "admin" : "staff";
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      role: usersTable.role,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);

  if (id === req.session.userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

export default router;
