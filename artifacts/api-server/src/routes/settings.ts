import { Router, type IRouter } from "express";
import { db, companySettingsTable } from "@workspace/db";
import { GetSettingsResponse, UpdateSettingsResponse, GetPublicSettingsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

async function getOrCreate() {
  const [existing] = await db.select().from(companySettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(companySettingsTable).values({}).returning();
  return created;
}

function toSettingsResponse(row: typeof companySettingsTable.$inferSelect) {
  return { ...row, goldApiTokenSet: !!(row.goldApiToken) };
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreate();
  res.json(GetSettingsResponse.parse(toSettingsResponse(settings)));
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
    showroomLogoUrl?: string;
    goldApiToken?: string;
  };
  const [updated] = await db
    .update(companySettingsTable)
    .set(body)
    .where(eq(companySettingsTable.id, settings.id))
    .returning();
  res.json(UpdateSettingsResponse.parse(toSettingsResponse(updated)));
  broadcast("SETTINGS_MUTATION");
});

// Public, unauthenticated router — mounted separately, before the requireAuth
// gate, so the showroom TV price-display board can fetch its custom logo
// without a logged in session. Only exposes the showroom logo URL; never
// leaks company contact details or other admin-only settings.
export const publicSettingsRouter: IRouter = Router();
publicSettingsRouter.get("/settings/public", async (_req, res): Promise<void> => {
  const settings = await getOrCreate();
  res.json(GetPublicSettingsResponse.parse({
    showroomLogoUrl: settings.showroomLogoUrl,
  }));
});

export default router;
