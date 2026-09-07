import type { DailyMetric } from '../metrics/engine';
export interface Connector {
  readonly provider: string;
  connect(state: string): Promise<{ authorizationUrl: string }>;
  disconnect(): Promise<void>;
  refreshToken(): Promise<void>;
  sync(cursor?: string): Promise<{ cursor: string; imported: number }>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  fetchMetrics(from: Date, to: Date): Promise<DailyMetric[]>;
  fetchEvents(cursor?: string): Promise<{ id: string; type: string; occurredAt: string }[]>;
  executeAction(action: { approvalId: string; idempotencyKey: string; payload: unknown }): Promise<{ externalId: string }>;
}
export const integrationCatalog = [
  {id:'salla',name:'Salla',category:'Commerce',color:'#00ab91',letter:'س'},
  {id:'zid',name:'Zid',category:'Commerce',color:'#8355ce',letter:'ز'},
  {id:'meta',name:'Meta Ads',category:'Advertising',color:'#1877f2',letter:'∞'},
  {id:'tiktok',name:'TikTok Ads',category:'Advertising',color:'#15171c',letter:'♪'},
  {id:'google-ads',name:'Google Ads',category:'Advertising',color:'#4285f4',letter:'A'},
  {id:'ga4',name:'Google Analytics',category:'Analytics',color:'#ef9619',letter:'▥'},
  {id:'search-console',name:'Search Console',category:'Analytics',color:'#4285f4',letter:'G'},
  {id:'gmail',name:'Gmail',category:'Communication',color:'#df5147',letter:'M'},
  {id:'calendar',name:'Google Calendar',category:'Communication',color:'#4285f4',letter:'31'},
] as const;
