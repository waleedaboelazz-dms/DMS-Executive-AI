import { z } from 'zod';
import { aggregate, change, type DailyMetric } from '../metrics/engine';
import type { SourceSummary } from '../integrations/types';
import type { AiToolSpec } from '../platform/contracts';

// Internal tool layer for the AI executive. The model never receives businessId/userId or raw rows —
// every tool closes over a ToolDataset that the API route already fetched for one authorized business.
// This is the authorization boundary: the LLM can only pick which of these pre-scoped views to read.

export const rangeNameSchema = z.enum(['today', 'yesterday', 'last7', 'previous7', 'last30']);
export type RangeName = z.infer<typeof rangeNameSchema>;

export type IntegrationFreshness = { provider: string; status: string; lastSync: string | null };
export type CatalogProduct = { name: string; sku: string | null; inventoryQuantity: number | null; status: string };
export type CustomerSummary = { totalCustomers: number; statsAvailable: boolean; returningCustomers: number; newCustomers: number; totalSpent: number };

export type ToolDataset = {
  businessName: string;
  currency: string;
  metrics: DailyMetric[];
  sources: SourceSummary[];
  integrations: IntegrationFreshness[];
  products: CatalogProduct[];
  customerSummary: CustomerSummary | null;
  generatedAt: string;
};

const DAY = 86_400_000;
const STALE_AFTER_MINUTES = 360;
const LOW_STOCK_THRESHOLD = 5;

function windowBounds(range: RangeName, now: number) {
  const todayStart = Math.floor(now / DAY) * DAY;
  const table: Record<RangeName, { curStart: number; curEnd: number; prevStart: number; prevEnd: number }> = {
    today: { curStart: todayStart, curEnd: todayStart + DAY, prevStart: todayStart - DAY, prevEnd: todayStart },
    yesterday: { curStart: todayStart - DAY, curEnd: todayStart, prevStart: todayStart - 2 * DAY, prevEnd: todayStart - DAY },
    last7: { curStart: todayStart - 7 * DAY, curEnd: todayStart, prevStart: todayStart - 14 * DAY, prevEnd: todayStart - 7 * DAY },
    previous7: { curStart: todayStart - 14 * DAY, curEnd: todayStart - 7 * DAY, prevStart: todayStart - 21 * DAY, prevEnd: todayStart - 14 * DAY },
    last30: { curStart: todayStart - 30 * DAY, curEnd: todayStart, prevStart: todayStart - 60 * DAY, prevEnd: todayStart - 30 * DAY },
  };
  return table[range];
}
function within(rows: DailyMetric[], start: number, end: number) { return rows.filter(r => { const t = Date.parse(r.date + 'T00:00:00Z'); return t >= start && t < end; }); }
function trendOf(current: number, previous: number): 'up' | 'down' | 'flat' { return current > previous ? 'up' : current < previous ? 'down' : 'flat'; }

type Comparison = { available: true; range: RangeName; currentValue: number; previousValue: number; absoluteChange: number; percentageChange: number | null; trend: 'up' | 'down' | 'flat'; observedDays: number; comparisonDays: number; source: 'manual_daily_ledger' } | { available: false; range: RangeName; reason: string };

function comparison(dataset: ToolDataset, range: RangeName, key: 'revenue' | 'orders', now = Date.now()): Comparison {
  const bounds = windowBounds(range, now);
  const currentRows = within(dataset.metrics, bounds.curStart, bounds.curEnd);
  const previousRows = within(dataset.metrics, bounds.prevStart, bounds.prevEnd);
  if (!currentRows.length && !previousRows.length) return { available: false, range, reason: 'No manually recorded metrics fall within this period.' };
  const current = aggregate(currentRows)[key];
  const previous = aggregate(previousRows)[key];
  return {
    available: true, range, currentValue: current, previousValue: previous,
    absoluteChange: Math.round((current - previous) * 100) / 100,
    percentageChange: change(current, previous),
    trend: trendOf(current, previous),
    observedDays: currentRows.length, comparisonDays: previousRows.length,
    source: 'manual_daily_ledger',
  };
}

export function getRevenueMetrics(dataset: ToolDataset, args: { range: RangeName }) { return comparison(dataset, args.range, 'revenue'); }

export function getOrdersMetrics(dataset: ToolDataset, args: { range: RangeName }) {
  const base = comparison(dataset, args.range, 'orders');
  if (!base.available) return base;
  const bounds = windowBounds(args.range, Date.now());
  const averageOrderValue = aggregate(within(dataset.metrics, bounds.curStart, bounds.curEnd)).aov;
  return { ...base, averageOrderValue };
}

export function getBusinessOverview(dataset: ToolDataset) {
  return {
    businessName: dataset.businessName,
    currency: dataset.currency,
    revenueLast7Days: comparison(dataset, 'last7', 'revenue'),
    ordersLast7Days: comparison(dataset, 'last7', 'orders'),
    connectedSources: dataset.sources.map(s => ({ provider: s.provider, from: s.from, to: s.to, currency: s.currency, totals: s.totals })),
    inventory: getInventoryAlerts(dataset),
    customers: getCustomerMetrics(dataset),
    dataFreshness: getDataFreshness(dataset).integrations,
    generatedAt: dataset.generatedAt,
  };
}

const notImported = (subject: string) => ({ available: false as const, reason: `${subject} is not imported from any connected source yet.` });

// Deliberately always unavailable: ranking products by sales requires order-to-product line items,
// which no connected connector fetches yet. The product catalog (price/stock) exists but is not sales data.
export function getTopProducts(dataset: ToolDataset) {
  if (!dataset.products.length) return notImported('Product-level data');
  return { available: false as const, reason: 'Order-to-product line items are not imported, so sales-based product ranking is not available. A product catalog is connected (name/price/stock only); use getInventoryAlerts for stock levels.' };
}

export function getInventoryAlerts(dataset: ToolDataset) {
  if (!dataset.products.length) return notImported('Inventory data');
  const tracked = dataset.products.filter(p => p.inventoryQuantity !== null);
  const lowStock = tracked.filter(p => p.inventoryQuantity! < LOW_STOCK_THRESHOLD).sort((a, b) => a.inventoryQuantity! - b.inventoryQuantity!);
  return { available: true as const, threshold: LOW_STOCK_THRESHOLD, catalogSize: dataset.products.length, trackedForStock: tracked.length, lowStockCount: lowStock.length, lowStockItems: lowStock.slice(0, 20).map(p => ({ name: p.name, sku: p.sku, inventoryQuantity: p.inventoryQuantity })), source: 'salla_product_catalog' };
}

export function getCustomerMetrics(dataset: ToolDataset) {
  if (!dataset.customerSummary || !dataset.customerSummary.totalCustomers) return notImported('Customer-level data');
  const s = dataset.customerSummary;
  return {
    available: true as const, totalCustomers: s.totalCustomers,
    newCustomers: s.statsAvailable ? s.newCustomers : null, returningCustomers: s.statsAvailable ? s.returningCustomers : null,
    totalSpent: s.statsAvailable ? s.totalSpent : null,
    note: s.statsAvailable ? undefined : 'The connected store did not provide per-customer order counts, so new-vs-returning and total spend are unknown, not zero. Only the total customer count is reliable.',
    source: 'salla_customers',
  };
}

export function getDataFreshness(dataset: ToolDataset) {
  const now = Date.now();
  return {
    generatedAt: dataset.generatedAt,
    integrations: dataset.integrations.map(i => {
      const lastSyncMs = i.lastSync ? Date.parse(i.lastSync) : null;
      const minutesSinceSync = lastSyncMs === null ? null : Math.round((now - lastSyncMs) / 60_000);
      return { provider: i.provider, status: i.status, lastSync: i.lastSync, minutesSinceSync, stale: minutesSinceSync === null ? i.status === 'connected' : minutesSinceSync > STALE_AFTER_MINUTES };
    }),
  };
}

const rangeParam = { range: { type: 'string', enum: rangeNameSchema.options } } as const;
export const toolSpecs: AiToolSpec[] = [
  { name: 'getBusinessOverview', description: 'Snapshot of last-7-day revenue, orders and connected-source freshness for the current business.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'getRevenueMetrics', description: 'Revenue for a period compared to the prior equivalent period.', parameters: { type: 'object', properties: rangeParam, required: ['range'] } },
  { name: 'getOrdersMetrics', description: 'Order count and average order value for a period compared to the prior equivalent period.', parameters: { type: 'object', properties: rangeParam, required: ['range'] } },
  { name: 'getTopProducts', description: 'Best-selling products by revenue. Currently always unavailable: order-to-product line items are not imported by any connector.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'getInventoryAlerts', description: 'Low-stock inventory alerts from the connected product catalog, if one is synced.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'getCustomerMetrics', description: 'Aggregate customer counts (new vs. returning) and total spend, if customer data is synced.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'getDataFreshness', description: 'Last synchronization time and staleness for every connected data source.', parameters: { type: 'object', properties: {}, required: [] } },
];

export function executeTool(dataset: ToolDataset, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'getBusinessOverview': return getBusinessOverview(dataset);
    case 'getRevenueMetrics': return getRevenueMetrics(dataset, { range: rangeNameSchema.parse(args.range) });
    case 'getOrdersMetrics': return getOrdersMetrics(dataset, { range: rangeNameSchema.parse(args.range) });
    case 'getTopProducts': return getTopProducts(dataset);
    case 'getInventoryAlerts': return getInventoryAlerts(dataset);
    case 'getCustomerMetrics': return getCustomerMetrics(dataset);
    case 'getDataFreshness': return getDataFreshness(dataset);
    default: return { error: 'UNKNOWN_TOOL' };
  }
}

export const executiveBriefSchema = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  problems: z.array(z.string()),
  opportunities: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  dataFreshness: z.string(),
});
export type ExecutiveBrief = z.infer<typeof executiveBriefSchema>;
