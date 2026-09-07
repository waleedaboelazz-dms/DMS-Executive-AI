# Deployment

This is a Next.js **server** application (App Router, dynamic API routes, Prisma/MySQL, Supabase auth, an optional BullMQ/Redis worker). It needs a host that can run a persistent Node.js process — plain shared PHP-style hosting (upload files, no process) cannot run it. A VPS or a "Cloud/Node.js" hosting plan with root or container access is required.

## What has to be running

| Process | Purpose | Required? |
|---|---|---|
| `web` (Next.js server) | Serves the app and all `/api/*` routes | Always |
| `worker` (`npm run worker`) | Background Salla/Google/Search Console sync, scheduled auto-sync, lease recovery | Only if you want background sync; without it, manual "Sync now" still queues jobs that simply never run |
| MySQL | All application data | Always |
| Redis | Job queue for the worker | Only needed if you run the worker |

## Environment variables

Copy `.env.example` to `.env.production` on the server and fill in real values — see that file for the full list (database, Supabase, OpenAI, and one Client ID/Secret pair per provider you want to connect: Salla, Google, Meta, TikTok, Zid). `APP_URL` must be the real public HTTPS URL once deployed (OAuth redirect URIs are derived from it) and every provider's OAuth app must have that same URL's callback (`<APP_URL>/api/integrations/oauth/callback`) allow-listed on their side.

## Option A — Docker Compose (recommended on a VPS)

Ships MySQL, Redis, the web server, the worker, and a one-shot migration step together.

```sh
cp .env.example .env.production   # fill in real values; DATABASE_URL host must be "mysql" (the compose service name), e.g.
                                   # DATABASE_URL="mysql://root:<MYSQL_ROOT_PASSWORD>@mysql:3306/dms_executive_ai"
                                   # REDIS_URL="redis://redis:6379/0"
echo "MYSQL_ROOT_PASSWORD=<choose-a-strong-password>" >> .env.production
docker compose up -d --build
```

Put a reverse proxy with TLS (Nginx + Certbot, or Hostinger's built-in SSL if it fronts your VPS) in front of port 3000. Re-run `docker compose up -d --build` after pulling new code; the `migrate` service re-applies any new Prisma migrations automatically before `web`/`worker` start (safe to re-run — `prisma migrate deploy` is idempotent).

## Option B — Node + PM2 (no Docker)

For a VPS without Docker, or a Hostinger "Node.js App" panel.

```sh
npm ci
npm run build          # runs `prisma generate && next build`
DATABASE_URL="mysql://user:pass@127.0.0.1:3306/dms_executive_ai" npx prisma migrate deploy
pm2 start .next/standalone/server.js --name dms-web --env PORT=3000
pm2 start "npm run worker" --name dms-worker   # only if you need background sync
pm2 save
```

Put Nginx (or Hostinger's panel proxy) in front of port 3000 with TLS, and point it at the app. `pm2 startup` makes both processes survive a server reboot.

## Database

The project uses **MySQL** (migrated from an earlier PostgreSQL-only design specifically to run on common shared/VPS MySQL hosting, including Hostinger's). Local development already runs against XAMPP's MySQL — see `prisma/migrations/` for the applied schema. Never point production at the same database as an unrelated site; give this app its own database and user with least-privilege grants (`CREATE`, `ALTER`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `INDEX`, `REFERENCES`, `DROP` on that one database is enough — no `GRANT`/global privileges).

## First real login

1. Confirm `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are set and `<APP_URL>/**` is in Supabase's Authentication → URL Configuration → Redirect URLs.
2. Sign in (magic link, or "Continue with Google" if that provider is enabled in Supabase Authentication → Providers).
3. The first sign-in provisions an Organization + Business automatically (`workspace.provision` in `src/adapters/prisma.ts`).

## Security checklist before going live

- `CREDENTIAL_ENCRYPTION_KEY` is a real random 32-byte base64 secret, set only on the server, never committed.
- Every provider's OAuth callback URL is registered exactly as `<APP_URL>/api/integrations/oauth/callback` on that provider's app console.
- `SALLA_CUSTOM_OAUTH_ENABLED` reflects reality: Salla "Custom Mode" is documented as development/testing only, not for distributing to third-party merchants (see [Phase 2](PHASE_2.md)).
- MySQL and Redis are not exposed to the public internet (bind to localhost or a private network; only the reverse proxy is public).
- `.env.production` is never committed (already covered by `.gitignore`'s `.env*` rule) and is not world-readable on the server (`chmod 600`).
