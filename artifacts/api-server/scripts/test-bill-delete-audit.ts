#!/usr/bin/env tsx
/**
 * Static source-code verification: purchase-bill audit insert is inside the
 * DELETE handler's DB transaction.
 *
 * Motivation
 * ──────────
 * The DELETE /purchase-bills/:id handler writes an audit log entry after
 * deleting the bill and reversing its stock batches.  If that insert were ever
 * moved outside the db.transaction(...) callback, a server restart or crash
 * occurring between the transaction COMMIT and the rogue db.insert would leave
 * the bill deleted with zero trace in the audit log — a silent data-loss
 * scenario that runtime tests cannot reliably catch.
 *
 * The script bounds the search to just the DELETE handler's source text before
 * looking for the transaction block, so removing the DELETE transaction cannot
 * be masked by a later handler's (e.g. the PATCH handler's) transaction.
 *
 * Assertions
 * ──────────
 *   1. DELETE /purchase-bills/:id handler exists.
 *   2. The handler body is bounded before the next router.* call.
 *   3. A db.transaction(async (tx) => ...) call exists inside that body.
 *   4. tx.insert(auditLogTable) appears inside the transaction body.
 *   5. db.insert(auditLogTable) does NOT appear inside the transaction body.
 *   6. db.insert(auditLogTable) does NOT appear in the DELETE handler AFTER
 *      the transaction block.
 *   7. The action: "delete" string is present in the transaction body,
 *      confirming this is the delete-specific audit entry.
 *
 * Mutation guard (Test 2)
 * ──────────────────────
 * A second test synthesises a deliberately broken source (tx.insert replaced by
 * db.insert outside the transaction) and asserts the same assertions FAIL on
 * that mutated text.  This proves the assertions are actually load-bearing.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:bill-delete-audit
 *
 * No live server required.  Exits with code 1 on any failure.
 */

import { readFile } from "node:fs/promises";
import { resolve }  from "node:path";

// ── Tiny assertion harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

/**
 * Inverse assert — used in the mutation guard where we expect the assertion to
 * FAIL (i.e. the bad source should NOT satisfy the condition).
 */
function assertNot(cond: boolean, msg: string): void {
  assert(!cond, msg);
}

// ── Source extraction helpers ─────────────────────────────────────────────────

/**
 * Extract the full source text of a single router handler, from its own
 * `router.<method>(...)` opening up to (but not including) the next
 * `router.<method>(...)` call.  Returns null if the marker is not found.
 */
function extractHandler(source: string, handlerMarker: string): string | null {
  const start = source.indexOf(handlerMarker);
  if (start === -1) return null;

  const tail = source.slice(start);
  // Find the next router.* call after this one.
  const nextHandler = tail.slice(handlerMarker.length).search(
    /router\.(get|post|put|patch|delete|use)\s*\(/,
  );
  return nextHandler === -1
    ? tail
    : tail.slice(0, handlerMarker.length + nextHandler);
}

/**
 * Extract the body of the FIRST `db.transaction(async (tx) => { ... })` call
 * found in `scope` using brace-depth counting.  Returns null if not found.
 * The returned string includes the outer braces.
 */
function extractTransactionBody(scope: string): string | null {
  const txStart = scope.indexOf("db.transaction(async (tx) =>");
  if (txStart === -1) return null;

  const openBrace = scope.indexOf("{", txStart);
  if (openBrace === -1) return null;

  let depth = 0;
  for (let i = openBrace; i < scope.length; i++) {
    const ch = scope[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return scope.slice(openBrace, i + 1);
    }
  }
  return null; // unmatched brace
}

/**
 * Return the text that appears in `handlerSource` after the transaction block
 * (i.e. between the closing brace of the transaction and the end of the
 * handler).  Used to check nothing dangerous appears post-transaction.
 */
function afterTransactionIn(handlerSource: string, transactionBody: string): string {
  const txBodyIdx = handlerSource.indexOf(transactionBody);
  if (txBodyIdx === -1) return "";
  return handlerSource.slice(txBodyIdx + transactionBody.length);
}

// ── Test 1: real source assertions ───────────────────────────────────────────

async function testRealSource(source: string): Promise<void> {
  console.log("\nTest 1: Real source — DELETE handler audit insert is transaction-bounded");

  // ── Step 1: bound the DELETE handler ─────────────────────────────────────

  const deleteHandler = extractHandler(source, 'router.delete("/purchase-bills/:id"');
  assert(
    deleteHandler !== null,
    'DELETE /purchase-bills/:id handler found in purchase-bills.ts',
  );
  if (deleteHandler === null) return;

  // Sanity-check: the bounded text must NOT contain the PATCH handler.
  assert(
    !deleteHandler.includes('router.patch("/purchase-bills/:id/payment-status"'),
    'Bounded DELETE handler body does not extend into the PATCH handler',
  );

  // ── Step 2: extract the transaction block ─────────────────────────────────

  const transactionBody = extractTransactionBody(deleteHandler);
  assert(
    transactionBody !== null,
    'DELETE handler wraps its work in db.transaction(async (tx) => ...)',
  );
  if (transactionBody === null) return;

  // ── Step 3: core atomicity assertions ─────────────────────────────────────

  // The audit insert must use tx.insert inside the transaction.
  assert(
    transactionBody.includes("tx.insert(auditLogTable)"),
    'audit insert uses tx.insert(auditLogTable) inside the transaction body — atomicity guaranteed',
  );

  // Must not use db.insert inside (that would bypass tx isolation).
  assert(
    !transactionBody.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) inside the transaction body (would bypass tx isolation)',
  );

  // The insert must record action: "delete" — confirms it is the deletion entry.
  assert(
    transactionBody.includes('action: "delete"'),
    'Transaction body contains action: "delete" — audit records the correct action',
  );

  // ── Step 4: nothing dangerous after the transaction ───────────────────────

  const tail = afterTransactionIn(deleteHandler, transactionBody);
  assert(
    !tail.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) after the transaction block in the DELETE handler — crash-safe',
  );
}

// ── Test 2: mutation guard ────────────────────────────────────────────────────

/**
 * Synthesise a deliberately broken version of the DELETE handler where the
 * audit insert is moved outside the transaction, then verify that the same
 * assertions FAIL on that mutated text.  This proves the checks are not vacuous.
 */
async function testMutationGuard(source: string): Promise<void> {
  console.log("\nTest 2: Mutation guard — broken source correctly triggers assertion failures");

  // Build a mutated handler:
  //   1. Remove the tx.insert(auditLogTable) block from inside the transaction.
  //   2. Append a db.insert(auditLogTable) call AFTER the transaction's closing paren.

  const deleteHandler = extractHandler(source, 'router.delete("/purchase-bills/:id"');
  if (deleteHandler === null) {
    assert(false, "Could not extract DELETE handler for mutation test");
    return;
  }

  const transactionBody = extractTransactionBody(deleteHandler);
  if (transactionBody === null) {
    assert(false, "Could not extract transaction body for mutation test");
    return;
  }

  // Remove the tx.insert line from the transaction body.
  const txInsertIdx = transactionBody.indexOf("await tx.insert(auditLogTable)");
  if (txInsertIdx === -1) {
    assert(false, "Could not locate tx.insert(auditLogTable) in transaction body for mutation");
    return;
  }
  // Find the end of the statement (the semicolon or closing paren of the values call).
  // We'll remove from "await tx.insert" to the nearest ");" after it.
  const txInsertEnd = transactionBody.indexOf(");", txInsertIdx);
  if (txInsertEnd === -1) {
    assert(false, "Could not find end of tx.insert statement for mutation");
    return;
  }

  const mutatedTxBody = transactionBody.slice(0, txInsertIdx) +
    "/* audit insert removed */" +
    transactionBody.slice(txInsertEnd + 2);

  // Build a mutated handler: replace the original tx body, append db.insert after.
  const mutatedHandler = deleteHandler.replace(transactionBody, mutatedTxBody) +
    "\n  await db.insert(auditLogTable).values({ action: \"delete\" });\n";

  // Now run the assertions on the mutated text — they should FAIL.
  const mutatedTxBodyExtracted = extractTransactionBody(mutatedHandler);
  const hasTxInside = mutatedTxBodyExtracted?.includes("tx.insert(auditLogTable)") ?? false;
  const hasDbInside = mutatedTxBodyExtracted?.includes("db.insert(auditLogTable)") ?? false;

  const mutatedTail = mutatedTxBodyExtracted
    ? afterTransactionIn(mutatedHandler, mutatedTxBodyExtracted)
    : mutatedHandler;
  const hasDbAfter = mutatedTail.includes("db.insert(auditLogTable)");

  assertNot(
    hasTxInside,
    "Mutation guard: tx.insert(auditLogTable) correctly absent from broken transaction body",
  );
  assertNot(
    !hasDbInside && !hasDbAfter,
    "Mutation guard: db.insert(auditLogTable) is correctly detected in broken source (inside tx or after tx)",
  );
  assert(
    hasDbAfter,
    "Mutation guard: db.insert(auditLogTable) correctly detected after transaction block in broken source",
  );

  console.log("  (All mutation-guard assertions confirm the real-source checks are load-bearing)");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n━━━ Purchase-bill delete audit — transaction-boundary check ━━━");
  console.log("  (Catches the server-restart data-loss scenario: if the audit");
  console.log("   insert were outside the transaction, a crash between COMMIT");
  console.log("   and the insert would leave the bill deleted but unrecorded.)");

  // The script is run from artifacts/api-server/ by pnpm --filter.
  const routeFile = resolve(process.cwd(), "src/routes/purchase-bills.ts");
  let source: string;
  try {
    source = await readFile(routeFile, "utf-8");
  } catch (err) {
    assert(false, `Could not read purchase-bills.ts (${routeFile}): ${err}`);
    console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
    process.exit(1);
  }

  await testRealSource(source);
  await testMutationGuard(source);

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
