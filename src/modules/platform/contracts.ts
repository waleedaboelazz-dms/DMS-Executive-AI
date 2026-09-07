import type { DailyMetric } from '../metrics/engine';
export type TenantContext = { userId: string; organizationId: string; role: string };
export interface MetricsRepository { list(businessId: string, tenant: TenantContext): Promise<DailyMetric[]>; save(businessId: string, tenant: TenantContext, metric: DailyMetric): Promise<void>; }
export type AiToolSpec = { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } };
export type AiToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export interface AiProvider {
  generate(input: { instructions: string; context: string; question: string; history: { question: string; answer: string }[]; signal?:AbortSignal }): Promise<string>;
  // Optional: providers that support function/tool calling can implement this instead of relying on stuffed context.
  converse?(input: { instructions: string; question: string; history: { question: string; answer: string }[]; tools: AiToolSpec[]; call: AiToolCall; signal?:AbortSignal }): Promise<string>;
}
export interface ReportRepository { save(input: { businessId: string; tenant: TenantContext; title: string; content: string; context: object; kind: string }): Promise<{ id: string }>; }
export interface AuditSink { record(input: { businessId: string; tenant: TenantContext; action: string; reason: string; result: string }): Promise<void>; }
