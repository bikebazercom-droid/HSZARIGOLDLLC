import { Router, type IRouter } from "express";
import { db, companySettingsTable } from "@workspace/db";
import { GetSettingsResponse, UpdateSettingsResponse, GetPublicSettingsResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/socket.js";
import { triggerGoldApiPoll, setGoldApiActive, triggerUniRatePoll, setUniRateActive } from "./prices.js";

const router: IRouter = Router();

async function getOrCreate() {
  const [existing] = await db.select().from(companySettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(companySettingsTable).values({}).returning();
  return created;
}

function toSettingsResponse(row: typeof companySettingsTable.$inferSelect) {
  return {
    ...row,
    goldApiTokenSet:    !!(row.goldApiToken),
    uniRateApiTokenSet: !!(row.uniRateApiToken),
  };
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
    goldApiEnabled?: boolean;
    uniRateApiToken?: string;
    uniRateApiEnabled?: boolean;
  };

  // Build the patch explicitly — only include keys that were actually sent in
  // the request body. Passing req.body directly to Drizzle's .set() can
  // accidentally null out columns (e.g. goldApiToken) when the client omits
  // them but Drizzle maps the missing key to NULL. This guards against that.
  type Patch = Partial<typeof companySettingsTable.$inferInsert>;
  const patch: Patch = {};
  if (body.companyName       !== undefined) patch.companyName       = body.companyName;
  if (body.tagline           !== undefined) patch.tagline           = body.tagline;
  if (body.address           !== undefined) patch.address           = body.address;
  if (body.phone             !== undefined) patch.phone             = body.phone;
  if (body.email             !== undefined) patch.email             = body.email;
  if (body.trn               !== undefined) patch.trn               = body.trn;
  if (body.locationUrl       !== undefined) patch.locationUrl       = body.locationUrl;
  if (body.logoType          !== undefined) patch.logoType          = body.logoType;
  if (body.logoInitial       !== undefined) patch.logoInitial       = body.logoInitial;
  if (body.logoImageUrl      !== undefined) patch.logoImageUrl      = body.logoImageUrl;
  if (body.stampSignatureUrl !== undefined) patch.stampSignatureUrl = body.stampSignatureUrl;
  if (body.showroomLogoUrl   !== undefined) patch.showroomLogoUrl   = body.showroomLogoUrl;
  // goldApiToken: only touch when explicitly sent — empty string clears the token.
  if (body.goldApiToken !== undefined) patch.goldApiToken = body.goldApiToken || null;
  if (body.goldApiEnabled !== undefined) patch.goldApiEnabled = body.goldApiEnabled;
  // uniRateApiToken: same sentinel pattern as goldApiToken
  if (body.uniRateApiToken !== undefined) patch.uniRateApiToken = body.uniRateApiToken || null;
  if (body.uniRateApiEnabled !== undefined) patch.uniRateApiEnabled = body.uniRateApiEnabled;

  const [updated] = await db
    .update(companySettingsTable)
    .set(patch)
    .where(eq(companySettingsTable.id, settings.id))
    .returning();
  res.json(UpdateSettingsResponse.parse(toSettingsResponse(updated)));
  broadcast("SETTINGS_MUTATION");

  // If the GoldAPI toggle was explicitly turned OFF, immediately deactivate in-memory.
  if (body.goldApiEnabled === false) setGoldApiActive(false);
  if (body.goldApiToken || body.goldApiEnabled === true) triggerGoldApiPoll();

  // UniRate: same immediate-effect pattern
  if (body.uniRateApiEnabled === false) setUniRateActive(false);
  if (body.uniRateApiToken || body.uniRateApiEnabled === true) triggerUniRatePoll();
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
