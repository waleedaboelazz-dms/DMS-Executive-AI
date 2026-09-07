import { contextFor, reportText, type DailyMetric } from '../metrics/engine';
import type { ReportRepository, TenantContext } from '../platform/contracts';
import type { ExecutiveAgent } from '../ai/executive';
import type { SourceSummary } from '../integrations/types';
export class ReportService {
  constructor(private repository: ReportRepository, private agent?: ExecutiveAgent) {}
  async create(input: { businessId: string; tenant: TenantContext; rows: DailyMetric[]; days: number; language: 'ar' | 'en'; ai: boolean; sources?:SourceSummary[] }) {
    if (!input.rows.length&&!input.sources?.length) throw new Error('NO_METRICS');
    if (input.ai && !this.agent) throw new Error('AI_NOT_CONFIGURED');
    const context = {...contextFor(input.rows, input.days),connectedSources:input.sources??[]};
    const appendix=(input.sources??[]).map(s=>`${s.provider} · ${s.from} – ${s.to} · ${s.currency} · ${s.timezone}\n${Object.entries(s.totals).map(([key,value])=>`${key}: ${value}`).join('\n')}\n${s.notes.join('\n')}`).join('\n\n');
    const content = input.ai ? await this.agent!.respond({ ...input, question: 'Create an executive report: results, risks, opportunities and next steps.' }) : reportText(input.rows, input.days, input.language)+(appendix?'\n\n'+(input.language==='ar'?'المصادر المتصلة — فترات مستقلة عن السجل اليدوي':'Connected sources — periods independent of the manual ledger')+'\n\n'+appendix:'');
    const title = `${input.days}-day executive report · ${context.periodEnd??input.sources?.[0]?.to??'source data'}`;
    return { ...await this.repository.save({ ...input, title, content, context, kind: input.ai ? 'ai' : 'deterministic' }), title, content };
  }
}
