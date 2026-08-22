# Hazari Gold — Hostinger deployment package

This package is a production build of the complete Hazari Gold system:

- `server/` is the Node.js application that serves both the API and the React dashboard.
- `server/public/` contains the compiled website.
- `server/artifacts/api-server/assets/` contains the branded PDF assets.

The application is intentionally served from **one Node Web App** and one domain. The browser calls `/api/...` and Socket.IO calls `/api/socket.io` on that same domain, so do not split `public/` onto a different website or configure a separate API URL.

## What you need first

1. A Hostinger **Web Apps Hosting** plan with Node.js support.
2. A PostgreSQL database that is reachable from the Hostinger Node application.
3. Your production database connection string.
4. A new, long random session secret. Never reuse a development secret.

## Deploy in hPanel

1. In hPanel, create a **Node.js Web App** for the domain or subdomain that will host Hazari Gold.
2. Choose **Upload your website files** and upload `Hazari-Gold-Hostinger.zip`.
3. Select **Other** if Hostinger asks for the framework.
4. Confirm these build settings:
   - **Output directory:** `.`
   - **Entry file:** `index.mjs`
   - No source build is needed; the React and Node applications are already compiled.
5. Hostinger installs the production dependency from `package.json` automatically during deployment.
6. Add the environment variables listed in `.env.example` in Hostinger's environment-variable interface. Do **not** upload an actual `.env` file.
7. Set the app's Node.js version to **20 or later**, then deploy.
8. For a new empty PostgreSQL database, import `database-schema.sql` before the first live start:

   ```bash
   psql "$DATABASE_URL" < database-schema.sql
   ```

   Run this from a secure computer with PostgreSQL tools. If you connect an existing Hazari Gold production database, do not import the schema again.
9. Visit `https://your-domain.example/api/healthz` and then open the site root. Sign in and generate a sample PDF to confirm the deployment.

## Important notes

- Hostinger supplies `PORT` for a Node Web App in many configurations. If its panel exposes a port setting instead, use that value for `PORT`.
- `STATIC_DIR=./public` makes the Node process serve the dashboard and its client-side routes.
- The package contains no credentials, database data, tests, source maps, development dependencies, or Replit configuration.
- Keep the branded assets folder exactly where it is. Purchase Bill PDFs use it at runtime.
- Secure session cookies are enabled whenever `NODE_ENV=production`, so use HTTPS on the assigned domain.
- Login sessions are stored in PostgreSQL and survive Node application restarts.
- `INITIAL_ADMIN_MOBILE` and `INITIAL_ADMIN_PIN` are only used when the database has no `admin` user. Existing production admin credentials are never reset.

## Updating later

Upload the new ZIP from the Node.js Web App deployment screen and redeploy. Keep the same `DATABASE_URL` and `SESSION_SECRET` values unless you intentionally rotate them.