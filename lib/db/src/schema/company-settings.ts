import { pgTable, serial, text, boolean } from "drizzle-orm/pg-core";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default("HAZARI GOLD L.L.C"),
  tagline: text("tagline"),
  address: text("address").notNull().default("Matar Abdul Rahman Khalfan Al Muhairi Building, 1st Floor, Room# 101, Deira, Dubai, UAE"),
  phone: text("phone").notNull().default("+971 50 536 4193"),
  email: text("email").notNull().default("hazarigoldllc@gmail.com"),
  trn: text("trn").notNull().default("105301944200003"),
  locationUrl: text("location_url"),
  logoType: text("logo_type").notNull().default("monogram"),
  logoInitial: text("logo_initial").notNull().default("H"),
  logoImageUrl: text("logo_image_url"),
  stampSignatureUrl: text("stamp_signature_url"),
  showroomLogoUrl: text("showroom_logo_url"),
  goldApiToken: text("gold_api_token"),
  goldApiEnabled: boolean("gold_api_enabled").notNull().default(true),
  uniRateApiToken: text("uni_rate_api_token"),
  uniRateApiEnabled: boolean("uni_rate_api_enabled").notNull().default(true),
});
