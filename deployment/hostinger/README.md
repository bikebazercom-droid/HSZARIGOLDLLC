# Hazari Gold — Supabase and Hostinger deployment

This is a prebuilt production package. One Node.js process serves the compiled React dashboard, Express API, Socket.IO endpoint, and branded PDFs on one domain.

## 1. Connect the app to Supabase PostgreSQL

The app already uses PostgreSQL through `pg` and Drizzle. It reads `DATABASE_URL` in `lib/db/src/index.ts`; no Supabase JavaScript SDK or connection code change is required.

The existing connection code is:

```ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
export const db = drizzle(pool, { schema });
```

1. Create or open the Supabase project.
2. In Supabase, select **Connect** and copy the **Session pooler** connection string. Use session mode on port `5432`; it supports IPv4 and prepared statements. Hostinger Web Apps may be on an IPv4-only network. Do not construct the pooler hostname yourself.
3. Replace the password placeholder with the Supabase database password. URL-encode special characters in the password.
4. In Hostinger's Environment Variables, set `DATABASE_URL` to the complete connection string. Do not commit it or put it in the ZIP.
5. For a **new, empty** Supabase database, import `database-schema.sql` once from a secure computer with PostgreSQL tools:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database-schema.sql
   ```

   Do not import this schema into an existing production database. Back it up and apply a reviewed schema migration instead.

The application uses its own user login and PostgreSQL-backed Express sessions. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are not used by this server. The browser must not receive a database password or a Supabase service-role key.

## 2. Hostinger environment variables

Add these in hPanel under the Node.js Web App's environment variables. Add each key and value separately; do not include quote marks.

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Session pooler URI copied from **Connect**; session port `5432`. |
| `NODE_ENV` | Yes | `production` |
| `SESSION_SECRET` | Yes | A long, random, unique secret. Keep it private. |
| `PORT` | Hostinger-managed | Hostinger supplies this at runtime. Set it manually only if hPanel explicitly asks for it. |
| `STATIC_DIR` | ZIP package only | `./public` for the prebuilt ZIP; the repository-root `index.mjs` locates the built frontend automatically. |
| `INITIAL_ADMIN_MOBILE` | New database only | Initial administrator's mobile number. |
| `INITIAL_ADMIN_PIN` | New database only | Initial administrator's PIN. |
| `INITIAL_ADMIN_FULL_NAME` | Optional, new database only | Initial administrator's display name. |
| `LOG_LEVEL` | Optional | `info` |
| `AUDIT_LOG_RETENTION_MONTHS` | Optional | `24` |
| `AUDIT_LOG_WARN_THRESHOLD` | Optional | `1000` |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are **not required** for the current PostgreSQL/Drizzle backend. `GOLDAPI_KEY` is also **not currently read by this codebase**; adding it to Hostinger would have no effect until a GoldAPI integration is implemented.

## 3. Hostinger Node.js Web App settings

Use Node.js `20` or a newer supported LTS version. Choose **Other** if the wizard asks for a framework.

### Recommended: upload the production ZIP

Upload `Hazari-Gold-Hostinger-Production.zip`. Its top level is the app root and already contains `package.json`, `index.mjs`, `public/`, and the PDF assets.

| Hostinger field | Value |
| --- | --- |
| Root directory | `/` or leave empty (the archive root) |
| Build script | `build` (Hostinger runs `npm run build`) |
| Output directory | `.`; with **Other** and an entry file, Hostinger ignores this field |
| Entry file | `index.mjs` |
| Start command, if shown | `npm start` |
| Package manager | `npm` (the ZIP includes `package-lock.json`) |

The build script verifies that the precompiled server, frontend, and required PDF assets are present. It does not rebuild the source. Dependencies are installed from the included production manifest.

### Alternative: deploy from the GitHub repository

If you use Hostinger's GitHub deployment rather than the ZIP:

| Hostinger field | Value |
| --- | --- |
| Root directory | `releases/hostinger-package` |
| Build script | `build` |
| Output directory | `.` or leave empty |
| Entry file | `index.mjs` |
| Start command, if shown | `npm start` |
| Package manager | `npm` |

This subdirectory contains the same prebuilt app layout and its own `package.json` and `package-lock.json`. For the prebuilt-package method, set the app root to this subdirectory; direct monorepo-root deployment is supported below.

### If deploying the monorepo root

The repository root also includes an entry script for Hostinger. It starts the built API server from `artifacts/api-server/dist/index.mjs` and selects the built Gold Shop frontend from `artifacts/gold-shop/dist/public` (or the prebuilt package's `public/` directory).

| Hostinger field | Value |
| --- | --- |
| Root directory | `/` or repository root |
| Build command | `pnpm run build` |
| Output directory | Leave empty |
| Entry file | `index.mjs` |
| Start command, if shown | `pnpm start` |
| Package manager | `pnpm` |

The entry script checks that the API and frontend build outputs exist before starting. Do not configure Apache `.htaccess` rewrites for this Node.js app; Express serves both the frontend and `/api` routes from the Node process.

The package scripts are:

```json
{
  "scripts": {
    "build": "node scripts/verify-production-bundle.mjs",
    "start": "node index.mjs"
  }
}
```

If a terminal is available after deployment, the equivalent manual commands are:

```bash
npm ci --omit=dev
npm run build
npm start
```

Hostinger's managed deployment normally installs dependencies and starts the configured entry file; do not run a second server process in parallel.

## 4. Verify the deployment

1. Wait for Hostinger's deployment to finish and check the Node.js runtime logs if it fails.
2. Open `https://your-domain.example/api/healthz`; it should return `{"status":"ok"}`.
3. Open the domain root, sign in, and verify that dashboard data loads.
4. Generate a Purchase Bill PDF to confirm the bundled logo, stamp, QR, and font are available.
5. Confirm WebSocket updates work through the same domain at `/api/socket.io`.

The app creates its PostgreSQL session table during startup. Existing administrator credentials are not overwritten. Keep HTTPS enabled so production session cookies are secure.

## References

- [Supabase: Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Hostinger: Build settings](https://docs.hostinger.com/node.js/build-settings)
- [Hostinger: Create a Node.js app](https://docs.hostinger.com/node.js/creating-an-app)
