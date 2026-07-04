import { Router, type IRouter } from "express";
import { db, companySettingsTable } from "@workspace/db";
import { GetSettingsResponse, UpdateSettingsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function getOrCreate() {
  const [existing] = await db.select().from(companySettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(companySettingsTable).values({}).returning();
  return created;
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreate();
  res.json(GetSettingsResponse.parse(settings));
});

router.put("/settings", async (req, res): Promise<void> => {
  const settings = await getOrCreate();
  const body = req.body as {
    companyName?: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    trn?: string;
    locationUrl?: string;
    logoType?: string;
    logoInitial?: string;
    logoImageUrl?: string;
    stampSignatureUrl?: string;
  };
  const [updated] = await db
    .update(companySettingsTable)
    .set(body)
    .where(eq(companySettingsTable.id, settings.id))
    .returning();
  res.json(UpdateSettingsResponse.parse(updated));
});

export default router;
