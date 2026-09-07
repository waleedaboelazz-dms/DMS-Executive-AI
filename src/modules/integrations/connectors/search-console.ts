import { ConnectorError, rangeSchema, sourceMetricSchema, type Credentials, type DateRange, type ReadConnector, type SyncResult } from '../types';
import { ProviderHttp, record, list, number, string } from '../http';

export class SearchConsoleConnector implements ReadConnector {
  readonly provider = 'search-console' as const;
  constructor(private credentials: Credentials, private http = new ProviderHttp()) { if (!credentials.accountId) throw new ConnectorError('CONFIGURATION'); }
  private siteUrl() { return this.credentials.accountId!; }
  private async query(range: DateRange) {
    return record(await this.http.json(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(this.siteUrl())}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: range.from, endDate: range.to, dimensions: ['date'], rowLimit: 1000 }),
    }));
  }
  async testConnection() { const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10); await this.query({ from: yesterday, to: yesterday }); }
  async fetchMetrics(input: DateRange): Promise<SyncResult> {
    const range = rangeSchema.parse(input), data = await this.query(range), raw = list(data.rows ?? []);
    if (raw.length >= 1000) throw new ConnectorError('IMPORT_LIMIT');
    const rows = raw.map(item => { const r = record(item); return sourceMetricSchema.parse({ date: string(list(r.keys)[0]), currency: 'SAR', impressions: Math.round(number(r.impressions)), clicks: Math.round(number(r.clicks)) }); });
    return { rows, records: rows.length, timezone: 'property timezone', notes: ['Search Console has no currency or revenue; rows are grouped under SAR only as a schema placeholder, not a monetary value.', 'Only clicks and impressions are imported; average position and CTR are not captured.'] };
  }
}
