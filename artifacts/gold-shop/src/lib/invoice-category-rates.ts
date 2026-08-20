const TEN_TOLA_9999_DESCRIPTIONS = new Set([
  "TEN TOLA BAR (0.9999)",
  "TT. BAR (0.9999)",
]);

const TEN_TOLA_999_DESCRIPTIONS = new Set([
  "TT. BAR (0.999)",
  "TT. BAR 24K",
]);

export function tenTolaPurityMultiplier(description: string): number {
  if (TEN_TOLA_9999_DESCRIPTIONS.has(description)) return 0.9999;
  if (TEN_TOLA_999_DESCRIPTIONS.has(description)) return 0.999;
  return 0.995;
}