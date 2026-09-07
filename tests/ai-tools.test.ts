import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRevenueMetrics, getOrdersMetrics, getTopProducts, getInventoryAlerts, getCustomerMetrics, getDataFreshness, executeTool, toolSpecs, executiveBriefSchema, type ToolDataset } from '../src/modules/ai/tools';
import { ExecutiveAgent } from '../src/modules/ai/executive';

const now = Date.UTC(2026, 8, 7); // 2026-09-07
const iso = (offsetDays: number) => new Date(now - offsetDays * 86_400_000).toISOString().slice(0, 10);
const metric = (date: string, revenue: number, orders: number) => ({ date, revenue, orders, adSpend: 0, cogs: 0, expenses: 0, leads: 0, sessions: 0 });

function dataset(overrides: Partial<ToolDataset> = {}): ToolDataset {
  return { businessName: 'iNatural', currency: 'SAR', metrics: [], sources: [], integrations: [], products: [], customerSummary: null, generatedAt: new Date(now).toISOString(), ...overrides };
}

test('getRevenueMetrics compares last7 vs previous7 and reports trend/percentage', () => {
  const ds = dataset({ metrics: [metric(iso(1), 1000, 10), metric(iso(2), 1000, 10), metric(iso(8), 500, 5), metric(iso(9), 500, 5)] });
  const result = getRevenueMetrics(ds, { range: 'last7' }) as { available: true; currentValue: number; previousValue: number; trend: string; percentageChange: number | null };
  assert.equal(result.available, true);
  assert.equal(result.currentValue, 2000);
  assert.equal(result.previousValue, 1000);
  assert.equal(result.trend, 'up');
  assert.equal(result.percentageChange, 100);
});

test('getRevenueMetrics and getOrdersMetrics report unavailable instead of a fabricated zero when no rows fall in window', () => {
  const ds = dataset();
  assert.deepEqual(getRevenueMetrics(ds, { range: 'today' }), { available: false, range: 'today', reason: 'No manually recorded metrics fall within this period.' });
  assert.equal((getOrdersMetrics(ds, { range: 'yesterday' }) as { available: boolean }).available, false);
});

test('getOrdersMetrics includes average order value for the current window only', () => {
  const ds = dataset({ metrics: [metric(iso(0), 300, 3)] });
  const result = getOrdersMetrics(ds, { range: 'today' }) as { available: true; averageOrderValue: number | null };
  assert.equal(result.averageOrderValue, 100);
});

test('Product, inventory and customer tools state data is unavailable rather than inventing figures when nothing is synced', () => {
  const ds = dataset();
  assert.equal(getTopProducts(ds).available, false);
  assert.equal(getInventoryAlerts(ds).available, false);
  assert.equal(getCustomerMetrics(ds).available, false);
  assert.match((getTopProducts(ds) as { reason: string }).reason, /not imported/);
});

test('getInventoryAlerts computes real low-stock items from a synced catalog and never fabricates a count for untracked stock', () => {
  const ds = dataset({ products: [
    { name: 'A', sku: 'A1', inventoryQuantity: 2, status: 'sale' },
    { name: 'B', sku: 'B1', inventoryQuantity: 20, status: 'sale' },
    { name: 'C', sku: null, inventoryQuantity: null, status: 'sale' },
  ] });
  const result = getInventoryAlerts(ds) as { available: true; catalogSize: number; trackedForStock: number; lowStockCount: number; lowStockItems: { name: string }[] };
  assert.equal(result.available, true);
  assert.equal(result.catalogSize, 3);
  assert.equal(result.trackedForStock, 2); // product C has unknown stock, not zero — excluded from tracked count
  assert.equal(result.lowStockCount, 1);
  assert.equal(result.lowStockItems[0].name, 'A');
});

test('getTopProducts stays unavailable even with a synced catalog, because sales-per-product is not imported', () => {
  const ds = dataset({ products: [{ name: 'A', sku: null, inventoryQuantity: 5, status: 'sale' }] });
  const result = getTopProducts(ds) as { available: false; reason: string };
  assert.equal(result.available, false);
  assert.match(result.reason, /line items/);
});

test('getCustomerMetrics only reports new/returning/spend when the store actually provided per-customer stats', () => {
  const noStats = getCustomerMetrics(dataset({ customerSummary: { totalCustomers: 12, statsAvailable: false, returningCustomers: 0, newCustomers: 12, totalSpent: 0 } })) as { available: true; totalCustomers: number; newCustomers: number | null; totalSpent: number | null; note?: string };
  assert.equal(noStats.totalCustomers, 12);
  assert.equal(noStats.newCustomers, null);
  assert.equal(noStats.totalSpent, null);
  assert.match(noStats.note!, /not zero/);

  const withStats = getCustomerMetrics(dataset({ customerSummary: { totalCustomers: 10, statsAvailable: true, returningCustomers: 4, newCustomers: 6, totalSpent: 900 } })) as { available: true; newCustomers: number | null; returningCustomers: number | null; totalSpent: number | null };
  assert.equal(withStats.newCustomers, 6);
  assert.equal(withStats.returningCustomers, 4);
  assert.equal(withStats.totalSpent, 900);
});

test('getDataFreshness flags a source stale past 6 hours and never fabricates a lastSync', () => {
  const ds = dataset({ integrations: [
    { provider: 'salla', status: 'connected', lastSync: new Date(now - 7 * 60 * 60_000).toISOString() },
    { provider: 'meta', status: 'connected', lastSync: null },
  ] });
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const result = getDataFreshness(ds);
    assert.equal(result.integrations[0].stale, true);
    assert.equal(result.integrations[1].lastSync, null);
    assert.equal(result.integrations[1].stale, true);
  } finally { Date.now = originalNow; }
});

test('No tool schema accepts businessId or userId — the model cannot select which business to read', () => {
  for (const spec of toolSpecs) assert.ok(!('businessId' in spec.parameters.properties) && !('userId' in spec.parameters.properties), `${spec.name} must not accept businessId/userId`);
});

test('executeTool ignores any businessId/userId the model tries to inject and stays scoped to the bound dataset', () => {
  const ds = dataset({ businessName: 'iNatural' });
  const result = executeTool(ds, 'getBusinessOverview', { businessId: 'someone-elses-business' }) as { businessName: string };
  assert.equal(result.businessName, 'iNatural');
});

test('ExecutiveAgent.chat drives tool-calling providers through executeTool instead of stuffing raw context', async () => {
  const calledTools: string[] = [];
  const agent = new ExecutiveAgent({
    generate: async () => { throw new Error('should not fall back to generate() when converse is available'); },
    converse: async input => { calledTools.push(...input.tools.map(t => t.name)); await input.call('getRevenueMetrics', { range: 'last7' }); return 'ok'; },
  });
  const ds = dataset({ metrics: [metric(iso(1), 100, 1)] });
  const answer = await agent.chat({ dataset: ds, question: 'How is revenue?', language: 'en' });
  assert.equal(answer, 'ok');
  assert.ok(calledTools.includes('getRevenueMetrics'));
});

test('ExecutiveAgent.chat falls back to generate() with a bounded overview when the provider has no tool support', async () => {
  let seenContext = '';
  const agent = new ExecutiveAgent({ generate: async input => { seenContext = input.context; return 'fallback answer'; } });
  const ds = dataset({ businessName: 'iNatural', metrics: [metric(iso(1), 100, 1)] });
  const answer = await agent.chat({ dataset: ds, question: 'How is revenue?', language: 'en' });
  assert.equal(answer, 'fallback answer');
  assert.equal(JSON.parse(seenContext).businessName, 'iNatural');
});

test('ExecutiveAgent.brief requires a tool-capable provider and validates the structured JSON schema', async () => {
  const noTools = new ExecutiveAgent({ generate: async () => 'x' });
  await assert.rejects(() => noTools.brief({ dataset: dataset(), days: 7, language: 'en' }), /AI_TOOLS_NOT_CONFIGURED/);

  const brokenJson = new ExecutiveAgent({ generate: async () => 'x', converse: async () => 'not json' });
  await assert.rejects(() => brokenJson.brief({ dataset: dataset(), days: 7, language: 'en' }), /AI_INVALID_JSON/);

  const valid = { summary: 's', wins: [], problems: [], opportunities: [], recommendedActions: [], confidence: 0.5, dataFreshness: 'synced 8 minutes ago' };
  const goodProvider = new ExecutiveAgent({ generate: async () => 'x', converse: async () => JSON.stringify(valid) });
  const brief = await goodProvider.brief({ dataset: dataset(), days: 7, language: 'en' });
  assert.deepEqual(executiveBriefSchema.parse(brief), valid);
});
