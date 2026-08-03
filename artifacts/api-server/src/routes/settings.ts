import { Router, type IRouter } from "express";
import { db, companySettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

async function getOrCreate() {
  const [existing] = await db.select().from(companySettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(companySettingsTable).values({}).returning();
  return created;
}

function serialize(row: typeof companySettingsTable.$inferSelect) {
  return {
    id:                row.id,
    companyName:       row.companyName,
    tagline:           row.tagline,
    address:           row.address,
    phone:             row.phone,
    email:             row.email,
    trn:               row.trn,
    locationUrl:       row.locationUrl,
    logoType:          row.logoType,
    logoInitial:       row.logoInitial,
    logoImageUrl:      row.logoImageUrl,
    stampSignatureUrl: row.stampSignatureUrl,
  };
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreate();
  res.json(serialize(settings));
});

router.put("/settings", async (req, res): Promise<void> => {
  const settings = await getOrCreate();
  const body = req.body as {
    companyName?:       string;
    tagline?:           string;
    address?:           string;
    phone?:             string;
    email?:             string;
    trn?:               string;
    locationUrl?:       string;
    logoType?:          string;
    logoInitial?:       string;
    logoImageUrl?:      string;
    stampSignatureUrl?: string;
  };

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

  const [updated] = await db
    .update(companySettingsTable)
    .set(patch)
    .where(eq(companySettingsTable.id, settings.id))
    .returning();

  res.json(serialize(updated));
  broadcast("SETTINGS_MUTATION");
});

export default router;
