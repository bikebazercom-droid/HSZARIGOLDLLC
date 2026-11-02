# Hazari Gold — Supabase and Hostinger deployment

This is a prebuilt production package. One Node.js process serves the compiled React dashboard, Express API, Socket.IO endpoint, and branded PDFs on one domain.

## 1. Connect the app to Supabase PostgreSQL

The app uses PostgreSQL through `pg` and Drizzle. Set `DATABASE_URL` to the Supabase Session pooler string. The shared PostgreSQL pool uses TLS with server certificate verification disabled, to work around Hostinger's reported self-signed certificate chain:

```ts
ssl: { rejectUnauthorized: false }
```

TLS encryption remains enabled, but the app no longer verifies the database server's identity. This is vulnerable to a man-in-the-middle attack. The same shared pool is used by Drizzle, price seeding, and the PostgreSQL session store; no CA file or SSL-related environment variable is required.

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
| `NODE_ENV` | Recommended | `production` (the packaged entry defaults to production if this is omitted). |
| `SESSION_SECRET` | Yes | A long, random, unique secret. Keep it private. |
| `PORT` | Hostinger-managed | Hostinger supplies this at runtime. Set it manually only if hPanel explicitly asks for it. |
| `STATIC_DIR` | Optional | `./public` is the packaged production default; set it explicitly to avoid ambiguity. |
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

If you use Hostinger's GitHub deployment rather than the ZIP, point the app at the prebuilt package. This avoids using the pnpm monorepo root with Hostinger's npm package manager:

| Hostinger field | Value |
| --- | --- |
| Root directory | `releases/hostinger-package` |
| Build script | `build` |
| Output directory | `.` or leave empty |
| Entry file | `index.mjs` |
| Start command, if shown | `npm start` |
| Package manager | `npm` |

This subdirectory contains the prebuilt app, its own `package.json`, `package-lock.json`, and Node.js engine requirement (`>=20`). Node.js 22.x is suitable. Do not deploy the monorepo root with npm: its install/build scripts require pnpm.

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

The Node process binds to `0.0.0.0` using Hostinger's `PORT`. It starts listening before database initialization, so the liveness route `/api/healthz` can respond while startup retries. `/api/readyz` reports readiness; business API calls return `503` until database connection, session storage, and required migrations finish. Initialization failures are logged with the failing stage and retried with increasing delays instead of terminating the process.

The initial admin settings create an account only when one does not exist. To intentionally reset an existing bootstrap admin, temporarily set `INITIAL_ADMIN_RESET_EXISTING=true`; startup will update its mobile, name, role, active state, and bcrypt PIN hash from the initial-admin settings. Verify login, then remove the flag. Routine restarts never overwrite existing admin credentials.

The prices singleton migration creates the `prices` table if it is absent, adds the singleton column as nullable before backfilling existing NULL values, preserves the newest row when consolidating legacy duplicates, and only then applies the default, `NOT NULL`, unique index, and check constraint. Startup logs include the nested PostgreSQL cause code and message if a migration still fails.

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
