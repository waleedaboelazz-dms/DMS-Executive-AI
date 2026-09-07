# Phase 3 — Automations, alerts, approvals and tasks

The Operations hub adds configurable rules, persisted alerts, task management, reviewable task approvals and a business audit trail. The UI supports English/Arabic, RTL, dark mode and mobile layouts. Demo actions use the same condition evaluator, are explicitly labeled, and persist only in this browser per demo business.

## Start

Apply all three migrations with `npm run db:deploy`, then rebuild/restart the server. A real workspace requires the Phase 1 MySQL/Supabase configuration. For background evaluation, set `REDIS_URL` and run `npm run worker`. The existing worker has a separate BullMQ operations schedule, so a failed provider import does not prevent the operations job from running. No additional paid API is needed.

Open **Automation**, create a rule, then explicitly enable it. Choose a metric, a strict greater-than/less-than threshold and 1–30 consecutive days. The action creates either an alert or an alert plus a pending task approval. **Evaluate now** works without Redis. The scheduler checks due businesses every minute and evaluates each enabled rule approximately hourly. Disabled rules never run. Rules are immutable after creation except enable/disable; replace a rule by disabling it and creating a revised one.

## Evidence and data boundaries

- Rules currently use the **manual daily ledger**, not connected source snapshots. Supported metrics: blended ROAS, estimated profit, revenue, orders and conversion percentage. Monetary thresholds use the business ledger currency.
- Evaluation ends yesterday in the business timezone. Every individual day in the selected window must satisfy the condition. Missing days, duplicate observations and undefined ratios do not trigger. Daily observations do not establish an intraday duration or causation.
- The latest evaluation stores the condition, period and daily observed values, including missing observations. Nonmatching/incomplete windows can be reevaluated after corrections. Once a rule has triggered for a window, corrections do not retract its alert or generate another one. A continuing condition can trigger again on the next completed day.
- Scheduler recovery evaluates the current completed-day window; it does not backfill every missed historical window. Saved evidence remains immutable for a triggered window. Alert resolution is manual and does not disable its rule.
- Rule evaluation and all related alerts, approvals and audit rows commit atomically. Business row locks plus a unique rule/window key prevent concurrent duplicate effects.

## Tasks and approvals

Tasks support title, priority, optional due date and open/in-progress/done status. A saved alert can create one linked task; repeated clicks return the same task. Task requests show their exact title, priority, due date and reason before a decision. Rejection creates no task. Approval validates the stored payload hash and atomically creates one task, records the approver/reason and marks the request executed. Repeated decisions return a conflict. To change an approval, reject it and submit a revised request. Owners may approve their own requests; separation of duties is not enforced in this increment.

Only the internal `create_task` executor is delivered. There is no campaign, budget, price, email, discount or product mutation executor. The API rejects unsupported actions. Do not interpret an approved task as a provider change. External action dispatch needs provider-specific executors, remote idempotency/reconciliation and its own approval policy in a subsequent increment.

Members can manage tasks, resolve alerts and propose tasks. Owners/admins additionally create/enable rules, run evaluations and approve/reject requests. Viewers cannot write. Every mutation rechecks current membership inside its transaction, including background jobs. API reads check organization ownership; all resource lookups scope to the current business. The activity tab shows the latest 50 operations audit records; each resource list shows the latest 100 entries. Pagination, assignment, task editing/deletion, projects and outbound notifications are not included.

## Embedding

`src/modules/operations/service.ts` exports schemas, `OperationsService`, `OperationsStore`, role policy and deterministic calendar-window evaluation without importing Next.js, Prisma, Redis or React. A host injects its own store into `new OperationsService(store)`. The store must enforce tenant membership and atomically persist decisions/effects/audit entries; the Prisma implementation demonstrates those guarantees. `src/adapters/operations/prisma-store.ts` is the standalone host adapter; `/api/operations` is its HTTP boundary. The scheduler is replaceable by a host invoking the service on its own schedule.

## Verification

`npm run test` covers condition completeness, strict per-day thresholds, undefined ratios, timezone boundaries, unsupported actions, portable authorization and demo decision transitions. `tests/operations.database.ts` targets only a disposable local test database and verifies tenant isolation, revoked membership, payload tampering, concurrent decisions, rejection, concurrent rule evaluation, missing-data recovery, linked task deduplication and audit. Playwright exercises rule creation, evidence-driven approval, task completion/persistence, demo business isolation, Arabic mobile layout and unauthenticated API denial.

Existing provider accounts, Supabase email delivery and OpenAI calls remain unverified live without configured external accounts. These operations tests do not certify external-action execution.
