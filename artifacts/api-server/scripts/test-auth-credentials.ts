import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  decideExistingAdminSeedAction,
  findUserByMobileAndPin,
  isFourDigitPin,
  normalizeMobile,
  pinMatchesHash,
} from "../src/lib/authCredentials.js";

const main = async (): Promise<void> => {
  const pin = "0426";
  const hash = await bcrypt.hash(pin, 4);

  assert.equal(await pinMatchesHash(pin, hash), true);
  assert.equal(await pinMatchesHash("0427", hash), false);
  assert.equal(await pinMatchesHash(pin, "not-a-bcrypt-hash"), false);

  assert.equal(normalizeMobile(" +971 (50) 536-4193 "), "+971505364193");
  assert.equal(normalizeMobile("01 8555 80555"), "01855580555");

  assert.equal(isFourDigitPin("0426"), true);
  assert.equal(isFourDigitPin("426"), false);
  assert.equal(isFourDigitPin("12a4"), false);
  assert.equal(isFourDigitPin(426), false);

  assert.equal(decideExistingAdminSeedAction(true, false), "unchanged");
  assert.equal(decideExistingAdminSeedAction(false, false), "preserve");
  assert.equal(decideExistingAdminSeedAction(false, true), "reset");

  const candidates = [
    { username: "old-admin", mobile: "+971 50 536 4193", passwordHash: await bcrypt.hash("9999", 4) },
    { username: "admin", mobile: "+971505364193", passwordHash: hash },
  ];
  const matchingUser = await findUserByMobileAndPin(
    candidates,
    "+971505364193",
    pin,
  );
  assert.equal(matchingUser?.username, "admin");
  assert.equal(
    await findUserByMobileAndPin(candidates, "+971505364193", "0000"),
    undefined,
  );

  console.log("Authentication credential checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
