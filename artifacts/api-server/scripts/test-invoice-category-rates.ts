#!/usr/bin/env tsx

import { tenTolaPurityMultiplier } from "../../gold-shop/src/lib/invoice-category-rates.js";

const cases = [
  ["TEN TOLA BAR (0.9999)", 0.9999],
  ["TEN TOLA BAR (0.995)", 0.995],
  ["TT. BAR (0.9999)", 0.9999],
  ["TT. BAR (0.999)", 0.999],
  ["TT. BAR 24K", 0.999],
  ["TT. BAR", 0.995],
] as const;

let passed = 0;
for (const [description, expected] of cases) {
  const actual = tenTolaPurityMultiplier(description);
  if (actual !== expected) {
    throw new Error(`${description}: expected ${expected}, got ${actual}`);
  }
  console.log(`  ✓ ${description} uses ${expected}`);
  passed++;
}

console.log(`\n━━━ Results: ${passed} passed, 0 failed ━━━\n`);