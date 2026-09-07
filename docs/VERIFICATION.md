# Verification record

Verified locally on 6 September 2026:

- Next.js production compilation and strict TypeScript checking.
- 10 core regression tests: financial math, integer-cent aggregation, missing periods, input validation, threshold alerts, Arabic reports, encryption tamper detection and portable service composition.
- 3 Playwright scenarios: daily edit/recalculation/persistence/report generation/RTL/dark mode; integration status, business switching and mobile navigation; denial of unauthenticated production APIs.
- Prisma schema validation and initial migration applied to disposable PostgreSQL 16.
- PostgreSQL integration assertions: decimal persistence, date upsert uniqueness, cross-tenant reads/writes rejected, viewer writes rejected, saved report + atomic audit, and 10 of 11 simultaneous AI rate-limit calls permitted.
- Desktop and Arabic mobile visual inspection.
- npm audit: zero reported vulnerabilities after deepmerge-ts override.

Not live-verified: Supabase account email-link delivery, real-session API access, OpenAI billing/model access, provider OAuth (not implemented), external actions (not implemented), public deployment. All external-service configuration is intentionally left to environment variables, with explicit errors when absent.

## Phase 2 verification

- 21 core/connector tests passed. Six provider fixtures exercise documented response fields, headers, pagination, currency separation and aggregate normalization. Signed attribution adjustments, HTTP origin allowlisting, bounded retries, malformed response rejection, no customer PII in normalized data, portable service composition and source-only AI context are covered.
- Three updated browser scenarios passed, including the new integration hub, demo credential exclusion, bilingual responsive layout and denial of unauthenticated integration/OAuth-start APIs.
- Both migrations applied to isolated PostgreSQL 16; Prisma migration-to-schema comparison returned no differences.
- Real PostgreSQL + Redis/BullMQ integration test passed: encrypted credentials, owner/admin enforcement, cross-tenant denial, queue execution, atomic snapshot replacement, removal of disappeared rows, idempotent completed jobs, disconnection fencing, and competing single-use OAuth state claims.
- The actual standalone sync worker started successfully against isolated Redis/PostgreSQL and initialized its recurring recovery scheduler.
- Desktop and Arabic mobile integration screens visually inspected; mobile content width is 390px at a 390px viewport.

Provider network responses in tests are fixtures, not live merchant/account responses. Google and Salla-development browser OAuth are implemented but end-to-end provider grants require your registered apps and accounts. Zid/Meta/TikTok browser onboarding, Salla Easy Mode marketplace webhooks and external business actions are not implemented. See PHASE_2.md for operational scope and limitations.

The development server may keep Prisma's Windows DLL open. Stop `npm run dev` before regenerating Prisma Client or rebuilding after a schema change on Windows.

## Phase 3 verification

- 26 unit/core/connector tests passed, including five operations scenarios for complete consecutive days, undefined ratios, timezone cutoffs, portable permissions, supported commands and demo approval transitions.
- Five browser scenarios passed after correcting the new test's select locator to use its accessible combobox role. Coverage includes creating/enabling/evaluating a rule, approving an exact task, completion and reload persistence, demo business isolation, Arabic mobile and API authorization denial.
- All three migrations applied to isolated PostgreSQL 16; migration-to-schema diff reported no differences.
- `tests/operations.database.ts` passed against PostgreSQL: cross-tenant denial, membership revocation, payload integrity, concurrent approval single execution, rejection, missing-day recovery, concurrent rule deduplication, linked task idempotency and audit.
- `tests/operations.worker.ts` passed against the actual running worker with Redis/BullMQ and PostgreSQL. The operations scheduler was registered and an actual queue job created an alert plus pending approval without creating a task.
- Production build and strict TypeScript checks passed. Arabic mobile screenshot visually checked with CSS transitions completed.
- No external account actions or paid AI calls were made. Phase 3 rules currently evaluate the manual ledger and execute only internal task creation after approval. See PHASE_3.md.
