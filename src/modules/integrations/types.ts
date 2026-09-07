import { z } from 'zod';
export const providerSchema=z.enum(['salla','zid','meta','tiktok','google-ads','ga4','search-console']);
export type ProviderId=z.infer<typeof providerSchema>;
// Most account IDs are numeric (GA4 property, Google Ads customer); Search Console identifies sites by URL
// (e.g. "https://example.com/" or "sc-domain:example.com"), so the shared pattern allows both shapes.
export const accountIdPattern=/^[A-Za-z0-9:._/-]{1,255}$/;
export const connectionSchema=z.object({
  accessToken:z.string().trim().min(10).max(8192),
  refreshToken:z.string().max(8192).optional(),
  authorizationToken:z.string().max(8192).optional(),
  developerToken:z.string().max(1024).optional(),
  accountId:z.string().regex(accountIdPattern).optional(),
  loginCustomerId:z.string().regex(/^\d{1,30}$/).optional(),
  expiresAt:z.iso.datetime().optional(),
});
export type Credentials=z.infer<typeof connectionSchema>;
export const rangeSchema=z.object({from:z.iso.date(),to:z.iso.date()}).refine(v=>v.from<=v.to && Date.parse(v.to)-Date.parse(v.from)<=30*86400000,'Choose an inclusive range of at most 31 days');
export type DateRange=z.infer<typeof rangeSchema>;
export const sourceMetricSchema=z.object({
  date:z.iso.date(),currency:z.string().regex(/^[A-Z]{3}$/),
  grossSales:z.number().finite().nonnegative().optional(),orders:z.number().int().nonnegative().optional(),
  adSpend:z.number().finite().nonnegative().optional(),impressions:z.number().int().nonnegative().optional(),clicks:z.number().int().nonnegative().optional(),
  sessions:z.number().int().nonnegative().optional(),conversions:z.number().finite().nonnegative().optional(),
  attributedRevenue:z.number().finite().optional(),
});
export type SourceMetric=z.infer<typeof sourceMetricSchema>;
export type SyncResult={rows:SourceMetric[];records:number;notes:string[];timezone:string};
export class ConnectorError extends Error {
  constructor(public code:'AUTH_EXPIRED'|'PERMISSION_DENIED'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'INVALID_RESPONSE'|'CONFIGURATION'|'IMPORT_LIMIT'|'NOT_SUPPORTED',public retryable=false){super(code);this.name='ConnectorError';}
}
// Catalog data (products/customers) is a full-mirror sync, not date-ranged like SourceMetric.
// "Top product by revenue" is deliberately not modelled here: it would require order line-item
// data this connector does not fetch, so getTopProducts stays honest about that gap.
export const normalizedProductSchema=z.object({
  externalId:z.string().min(1),name:z.string().min(1),sku:z.string().optional(),
  price:z.number().finite().nonnegative(),salePrice:z.number().finite().nonnegative().optional(),
  inventoryQuantity:z.number().int().optional(),status:z.string().min(1),
});
export type NormalizedProduct=z.infer<typeof normalizedProductSchema>;
export const normalizedCustomerSchema=z.object({
  externalId:z.string().min(1),name:z.string().min(1),email:z.string().optional(),phone:z.string().optional(),
  totalOrders:z.number().int().nonnegative().optional(),totalSpent:z.number().finite().nonnegative().optional(),
});
export type NormalizedCustomer=z.infer<typeof normalizedCustomerSchema>;
// One currency for the whole catalog snapshot (a store's product/customer money values share its account currency).
export type CatalogResult={products:NormalizedProduct[];customers:NormalizedCustomer[];currency:string;notes:string[]};
export interface ReadConnector {
  readonly provider:ProviderId;
  testConnection():Promise<void>;
  fetchMetrics(range:DateRange):Promise<SyncResult>;
  fetchCatalog?():Promise<CatalogResult>;
}
export type SourceSummary={provider:string;from:string;to:string;currency:string;timezone:string;observedDays:number;lastSync:string;totals:Omit<SourceMetric,'date'|'currency'>;notes:string[]};
export function summarizeSource(provider:string,result:SyncResult,lastSync:string):SourceSummary[] {
  return [...new Set(result.rows.map(r=>r.currency))].map(currency=>{
    const rows=result.rows.filter(r=>r.currency===currency).sort((a,b)=>a.date.localeCompare(b.date));
    const totals:Omit<SourceMetric,'date'|'currency'>={};
    for(const key of ['grossSales','orders','adSpend','impressions','clicks','sessions','conversions','attributedRevenue'] as const){const values=rows.map(r=>r[key]).filter((v):v is number=>v!==undefined);if(values.length)totals[key]=Math.round(values.reduce((a,v)=>a+v,0)*1e6)/1e6;}
    return {provider,from:rows[0].date,to:rows.at(-1)!.date,currency,timezone:result.timezone,observedDays:rows.length,lastSync,totals,notes:result.notes};
  });
}
