import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  findUserByMobileAndPin,
  isFourDigitPin,
  normalizeMobile,
} from "../lib/authCredentials.js";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = req.body as {
    mobile?: string;
    pin?: string;
    role?: string;
  };

  if (
    !body ||
    typeof body !== "object" ||
    typeof body.mobile !== "string" ||
    !body.mobile.trim() ||
    !isFourDigitPin(body.pin) ||
    (body.role !== "admin" && body.role !== "staff")
  ) {
    res.status(400).json({
      error: "Enter a mobile number, a four-digit PIN, and a valid account type.",
    });
    return;
  }

  const normalizedMobile = normalizeMobile(body.mobile);
  if (!normalizedMobile) {
    res.status(400).json({ error: "Enter a valid mobile number." });
    return;
  }

  const matchingMobileUsers = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, body.role),
        eq(usersTable.isActive, true)
      )
    );

  const candidates = matchingMobileUsers.sort((a, b) => {
    if (body.role !== "admin") return 0;
    return Number(b.username === "admin") - Number(a.username === "admin");
  });

  const user = await findUserByMobileAndPin(
    candidates,
    normalizedMobile,
    body.pin,
  );

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
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
