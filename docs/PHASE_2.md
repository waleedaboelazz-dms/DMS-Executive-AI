# Phase 2 — Read integrations and synchronization

## Delivered

Six independently reusable API connectors: Salla, Zid, Meta Ads, TikTok Ads, Google Ads and GA4. They fetch real provider APIs when configured; demo mode never collects tokens or simulates a successful connection. The hub supports verifying/storing tokens, disconnecting, selecting a date range, queuing imports, hourly scheduling, last-sync status, failures and the last five runs.

`src/modules/integrations` contains framework-free schemas, normalization, provider clients, a registry, source aggregation and IntegrationService. It depends on injected HTTP, storage and queue ports. `src/adapters/integrations` provides Prisma, encrypted token storage, OAuth and BullMQ. `src/workers/integrations.ts` is the standalone worker host. The existing host can inject its own job queue, credential vault and persistence without changing the provider clients.

## Setup

1. Run `npm install` and apply both migrations with `npm run db:deploy` using your configured `DATABASE_URL`.
2. Set `CREDENTIAL_ENCRYPTION_KEY` to a private random 32-byte base64 key. Keep it outside version control and keep a secure backup; rotating it requires re-encrypting existing credential envelopes.
3. Set `REDIS_URL`. Redis must be private and persistent for durable queue operation; production Redis should use authentication/TLS. Run `npm run worker` alongside the Next.js server. The worker reads the same local environment configuration.
4. Sign in, open your business, then Integrations. Only organization owners/admins can manage connections. Other members can read aggregate source results. Never paste credentials in chat.
5. Connect your account, choose up to 31 days, and click Sync now. Hourly synchronization is opt-in and rereads the last 30 days to incorporate corrections. The API/worker never changes campaigns, orders, prices or budgets.

## Provider setup and delivered data

| Provider | Credentials | Imported fields |
|---|---|---|
| Salla | OAuth access token with `orders.read`; optional refresh token and Salla client settings | Daily order count and gross order value, separated by currency |
| Zid | OAuth access token as `X-Manager-Token` plus Authorization token, `orders.read` | Daily order count and gross order value, separated by currency |
| Meta Ads | Existing OAuth/system-user access token, ad account ID without `act_`, supported `META_API_VERSION`, reporting permissions | Account daily spend, impressions, clicks, account currency/timezone |
| TikTok Ads | Business API access token and advertiser ID with reporting access | Account daily spend, impressions, clicks, currency/timezone |
| Google Ads | OAuth token, customer ID without hyphens, developer token; optional manager ID | Cost, impressions, clicks, conversions and conversion value; currency/timezone |
| GA4 | OAuth token with `analytics.readonly` and numeric property ID | Sessions, ecommerce purchase count and analytics purchase revenue; SAR reporting currency |

Token fields are submitted once to the authenticated API and AES-256-GCM encrypted. They are never returned by list APIs or stored in browser localStorage. Refresh tokens are optional; automatic refresh requires a supplied expiry and the matching server client ID/secret. An expired token without refresh configuration requires reconnection. Meta/TikTok tokens are replaced when needed; provider-specific long-lived token exchange is not implemented.

## Browser OAuth

GA4 and Google Ads support browser authorization using `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL`. Google Ads also needs server `GOOGLE_ADS_DEVELOPER_TOKEN` and optionally `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. Register the exact redirect URI:

`https://your-app.example/api/integrations/oauth/callback`

The flow uses a ten-minute, hashed, single-use state bound to an HttpOnly SameSite cookie and initiating tenant membership. Google uses PKCE. Refresh tokens and PKCE verifiers are encrypted at rest. Callback rechecks owner/admin membership and verifies the provider API before storing a connection. No callback result contains tokens.

Salla Custom OAuth is available only when `SALLA_CUSTOM_OAUTH_ENABLED=true`, with Salla client settings and the same callback URI. **Salla documents Custom Mode as development/testing only. Published Salla apps require Easy Mode.** Easy Mode installation/uninstallation webhooks, marketplace approval and public app distribution are not delivered here. Existing authorized access tokens can be used for private integrations. Zid/Meta/TikTok browser onboarding is not implemented; use already-issued provider OAuth tokens.

## Data semantics

- Imported data is stored separately from the manual financial ledger. Connecting several platforms cannot multiply revenue or overwrite manually recorded costs.
- Store totals are **gross order value across all statuses**, including unpaid/cancelled orders, taxes and shipping. They are not recognized revenue, collected cash, or profit. Refund reconciliation, product cost enrichment and order-status revenue policies require a subsequent commerce enhancement.
- GA4/advertising conversion value remains attributed value. It is never added to store totals. Google Ads conversion value includes all configured conversion actions, not only purchases.
- Source insights and AI/report context show each source's latest completed import window, currency, timezone and limitations. Different currencies are never summed. Missing dates and costs are not fabricated as zero. The manual dashboard still explicitly labels its ledger as manual data.
- Salla imports sequential pages of 30 and fails closed beyond 100 pages. Zid scans up to 100 pages of 15 and filters by created date locally because the retrieved reference did not establish stable date-filter semantics. Stores exceeding 1,500 Zid orders require a dedicated backfill strategy; smaller date selection does not reduce that scan.
- Bounded retries apply to transport errors, HTTP 429 and 5xx. Responses, amounts, date ranges and page progression are validated. Invalid or oversized imports do not overwrite the previous successful snapshot. Raw customer PII is discarded during normalization.

## Consistency and recovery

MySQL stores sync requests before Redis enqueue. The worker periodically recovers queued requests after an enqueue outage. Each import is an atomic replacement of that source/version/date window, including removal of records that disappeared. A connection version and lease owner fence stale workers; reconnect/disconnect cancels prior work and deletes local credentials on disconnect. Previous generations remain stored for audit/history but are excluded from current insights.

Disconnect stops local access; revoke the application grant separately at the provider. No remote revoke operation is falsely reported as completed. Queue failures and provider error codes are redacted and persisted with audit entries. No secrets or raw provider error bodies are logged. Failed runs can be explicitly retried with Sync now. OAuth-attempt and rate-limit expiry cleanup runs in the worker.

## Remaining work

Live merchant/account acceptance testing requires your external credentials and provider apps. These adapters have contract-fixture and local infrastructure tests; fixtures do not establish provider approval or live-account compatibility. Campaign/ad-set drilldowns, product/inventory/refund enrichment, webhooks, Search Console, Gmail and Calendar, full marketplace OAuth distribution and arbitrary historical backfills remain outside this read-integration increment. No external account was connected during development.

## Official references

- [Salla authorization](https://docs.salla.dev/authorization) and [list orders](https://docs.salla.dev/5394146e0).
- [Zid authorization](https://docs.zid.sa/authorization) and [list orders](https://docs.zid.sa/list-of-orders).
- [Meta official Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/overview).
- [TikTok official reporting SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md).
- [Google Ads REST search](https://developers.google.com/google-ads/api/rest/common/search) and [authorization](https://developers.google.com/google-ads/api/rest/auth).
- [GA4 runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport).
- [BullMQ job schedulers](https://docs.bullmq.io/guide/job-schedulers/).
