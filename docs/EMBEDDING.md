# Embed the core in an existing platform

The dependency direction is **host → adapters → service contracts**, never core → host. Framework-free files under `src/modules` are the public integration boundary. Keep the same services when replacing Next.js with NestJS, an existing backend, a worker, or a packaged SDK. Zod is the only runtime dependency in the metrics core.

```ts
import { ExecutiveAgent, ReportService, aggregate } from './src/modules';
import type { AiProvider, ReportRepository } from './src/modules';

// Implement these ports using the existing platform's AI gateway and database.
declare const existingAiGateway: AiProvider;
declare const existingReportStore: ReportRepository;
const executive = new ExecutiveAgent(existingAiGateway);
const reports = new ReportService(existingReportStore, executive);
const totals = aggregate([]);
```

Pass a verified TenantContext resolved by the host identity system. Repository implementations MUST enforce tenant scoping and permissions; receiving a businessId is not authorization. The supplied Prisma adapters enforce this through membership and organization queries. Replace adapters as units; do not copy Next.js routes into the host's core.

MetricsRepository is the manual-ledger read/write port and uses DailyMetric in SAR. Phase 2 connectors return a separate SourceMetric contract with original currency and source semantics; they do not write into the manual ledger. Source aggregation groups currencies without conversion. Preserve original currency, FX date/source, source event ID and idempotency key if adding currency conversion.

ExecutiveAgent accepts AiProvider; swapping OpenAI for Anthropic, Gemini or a local model does not change business calculations or ReportService. This MVP implements one executive agent. Future specialists should consume the same bounded aggregate context and return typed observations with evidence, uncertainty and recommendations. A master agent composes these observations, never raw credentials or unrestricted customer data.

ReportService returns portable text and structured metrics context; rendering is a host concern. The current UI supports text downloads and browser print-to-PDF. API adapters handle request validation, authentication, rate limits, audit persistence and error redaction. Keep those controls in any new host.

UI embedding options: mount the React workspace with a host data adapter in a later UI extraction, or build a native host interface against the core. The current standalone React workspace is intentionally an application shell, not a published drop-in widget. The service boundary is already reusable and tested without Next.js.

Phase 3 exposes `OperationsService` and `OperationsStore` from the public module entry point. Inject a host store and call `execute(businessId, verifiedTenant, command)`. The core validates commands/roles and the host store must enforce current tenant membership, immutable proposal integrity, atomic execution/audit and idempotency. `evaluateCondition` and `completedDay` can be used independently of a job queue. See `docs/PHASE_3.md` and the Prisma adapter for the full persistence contract.
