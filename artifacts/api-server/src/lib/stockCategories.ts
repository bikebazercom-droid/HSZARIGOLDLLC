export const STOCK_CATEGORIES = [
  "gold_9999",
  "ten_tola_bar",
  "kg_bar",
  "995",
  "gold_jewelry_22k",
  "silver",
] as const;

export type StockCategory = (typeof STOCK_CATEGORIES)[number];

export const STOCK_CATEGORY_LABEL: Record<string, string> = {
  gold_9999: "GOLD 9999",
  ten_tola_bar: "TEN TOLA BAR",
  kg_bar: "KG Bar",
  "995": "995",
  gold_jewelry_22k: "Gold Jewelry 22K",
  silver: "Silver",
};

export function normalizeCategoryValue(category: string | null | undefined): string | null {
  if (category == null) return null;
  if (category === "gold") return "gold_9999";
  if (category === "tt_bar") return "ten_tola_bar";
  return category;
}

export function normalizeInventoryDescription(
  description: string,
  category: string | null | undefined,
): string {
  const canonicalCategory = normalizeCategoryValue(category);

  if (canonicalCategory === "gold_9999") {
    if (/^GOLD$/i.test(description.trim())) return "GOLD 9999";
    if (/^GOLD\s*\(0\.9999\)$/i.test(description.trim())) return "GOLD 9999 (0.9999)";
  }

  if (canonicalCategory === "ten_tola_bar") {
    return description.replace(/^TT\.?\s*BAR/i, "TEN TOLA BAR");
  }

  return description;
}