# DMS Executive AI

A standalone modular executive workspace. The framework-free core in `src/modules` can also be embedded in another platform.

## Run the demo

Requires Node.js 22+.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Next.js runs as a Node server; Apache/XAMPP does not execute it directly. The default mode uses explicitly labeled, deterministic sample data through 6 September 2026. Demo edits and reports persist only in this browser. The date selector ends at the last recorded day, not the computer clock. Sample data is never sent to the AI API.

## Enable a real workspace

1. Copy `.env.example` to `.env.local`. Set a MySQL `DATABASE_URL`, Supabase project URL and public anon key. Supabase email OTP (and/or the Google sign-in button) must be enabled and the application URL allowlisted as an auth redirect. The public anon key is not a server secret; never expose a service-role key.
2. Prisma CLI reads `.env`, not `.env.local` by default. Set `DATABASE_URL` in your shell or a local ignored `.env` before running `npm run db:deploy`.
3. Set server-only `OPENAI_API_KEY` and `OPENAI_MODEL` to a model enabled on your OpenAI account. Restart the app. No model or paid API request is silently selected for you.
4. Settings → Sign in → open the email link → Open my workspace → create your first business. Add daily data. Create additional businesses from Businesses.
5. Generate report creates a deterministic saved report. Reports → Generate with AI and AI Executive use the actual Responses API. Missing configuration returns a clear error rather than a fabricated answer. Use Print / Save PDF in a report for browser PDF export.

## Delivered platform

- English/Arabic RTL, light/dark, mobile navigation, business and date filters.
- Calculated revenue, costs, profit, weighted blended ROAS, conversion and a documented partial health score.
- Validated manual daily upsert; organization isolation and server-side membership checks.
- Supabase email-link (and Google) authentication and MySQL persistence for real workspaces.
- Saved reports, an AI executive chat and structured "executive brief" that call real internal tools (`getRevenueMetrics`, `getInventoryAlerts`, etc.) scoped to one authorized business — never raw prompt-stuffed data — plus persisted history, audit records and database-backed AI rate limiting.
- Seven read-only provider connectors (Salla, Zid, Meta Ads, TikTok Ads, Google Ads, GA4 and Search Console), encrypted token setup, real OAuth with post-consent account/property discovery for Salla and every Google provider, background synchronization and source insights. Salla additionally syncs a product/inventory/customer catalog. See [Phase 2 setup and limitations](docs/PHASE_2.md).
- Automation rules on completed ledger days, persisted alerts, tasks, transactional task approvals and operation audits. See [Phase 3 setup and boundaries](docs/PHASE_3.md).

## Reuse without rewriting the core

See [architecture](docs/ARCHITECTURE.md) and [embedding guide](docs/EMBEDDING.md). `src/modules/index.ts` exports business contracts, the metrics engine, ExecutiveAgent and ReportService. These files do not import React, Next.js, Prisma, Supabase or OpenAI. The host injects persistence and AI provider implementations. `src/adapters` binds MySQL/OpenAI to those contracts; `src/app/api` is the standalone HTTP/auth composition layer.

## Deploying

See [deployment](docs/DEPLOYMENT.md) for running this outside local dev (Docker Compose or Node + PM2), environment variables, and a pre-launch security checklist. This needs a Node-capable host (VPS/Cloud) — not classic shared PHP hosting.

## Verification

```sh
npm run test
npm run typecheck
npm run build
npx playwright test
```

The browser tests need Playwright Chromium (`npx playwright install chromium`). They exercise editing/recalculation/persistence, reports, RTL, dark mode, navigation, mobile layout and unauthenticated API denial. Core tests cover numeric correctness, missing data, credential tampering and host-independent service composition. `tests/database.integration.ts` was run against a disposable PostgreSQL 16 database and checks persistence, cross-tenant denial, viewer denial, reports, audit transactions and concurrent rate limiting (historical: the project has since moved to MySQL — see [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for that Postgres-era record; the MySQL schema itself was smoke-tested directly against a real MySQL server after the migration, but this specific suite has not yet been re-run against MySQL). Supabase email delivery/session verification and actual AI calls still require your configured accounts and have not been live-tested.

## Delivery status

The Phase 1 MVP, Phase 2 read integrations and Phase 3 internal operations are implemented. See [Phase 2](docs/PHASE_2.md) for connector coverage and [Phase 3](docs/PHASE_3.md) for automation data boundaries and supported approval execution. External action executors, projects/CRM, forecasting, billing and multi-agent orchestration remain future work. Production rollout still requires real-account validation, provider approval where applicable, deployment configuration, backups, monitoring and security review. No email, campaign, budget or price changes are executed by this application.

Dependency note: `deepmerge-ts` is overridden to version 8 to remove the dependency advisory reported for Prisma's configuration dependency. Prisma generate, schema validation and build are verified against this override.
