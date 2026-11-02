import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "index.mjs",
  "public/index.html",
  "artifacts/api-server/assets/hazari-gold-logo.jpg",
  "artifacts/api-server/assets/hazari-gold-stamp.png",
  "artifacts/api-server/assets/Amiri-Regular.ttf",
  "artifacts/api-server/assets/hazari-gold-location-qr.png",
];

const missing = [];
for (const relativePath of requiredFiles) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    missing.push(relativePath);
  }
}

try {
  const assetFiles = await readdir(path.join(root, "public/assets"));
  if (!assetFiles.some((file) => /^index-.+\.js$/.test(file))) {
    missing.push("public/assets/index-*.js");
  }
} catch {
  missing.push("public/assets/");
}

if (missing.length > 0) {
  console.error(
    `Hostinger production bundle is incomplete. Missing: ${missing.join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log("Hostinger production bundle verified.");
}
