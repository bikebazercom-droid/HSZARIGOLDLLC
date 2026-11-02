import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const apiEntry = path.join(
  projectRoot,
  "artifacts",
  "api-server",
  "dist",
  "index.mjs",
);

if (!existsSync(apiEntry)) {
  throw new Error(
    "Built API entry was not found. Run `pnpm run build` before starting the app.",
  );
}

const staticDirCandidates = [
  process.env.STATIC_DIR?.trim(),
  path.join("artifacts", "gold-shop", "dist", "public"),
  path.join("releases", "hostinger-package", "public"),
]
  .filter((candidate) => Boolean(candidate))
  .map((candidate) => path.resolve(projectRoot, candidate));

const staticDir = staticDirCandidates.find((candidate) =>
  existsSync(path.join(candidate, "index.html")),
);

if (!staticDir) {
  throw new Error(
    "Built frontend index.html was not found. Run `pnpm run build` before starting the app.",
  );
}

process.env.STATIC_DIR = staticDir;

await import(pathToFileURL(apiEntry).href);
