import { eq } from "drizzle-orm";
import { db, pricesTable } from "@workspace/db";

export async function getOrCreatePrices() {
  const [created] = await db
    .insert(pricesTable)
    .values({ singletonKey: 1 })
    .onConflictDoNothing({ target: pricesTable.singletonKey })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(pricesTable)
    .where(eq(pricesTable.singletonKey, 1))
    .limit(1);
  if (!existing) throw new Error("Prices singleton initialization failed");
  return existing;
}