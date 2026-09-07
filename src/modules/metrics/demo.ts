import type { DailyMetric } from './engine';
export const demoBusinesses = [{ id: 'demo-natural', name: 'iNatural', subtitle: 'E-commerce' }, { id: 'demo-dms', name: 'DMS Studio', subtitle: 'Digital services' }];
export function demoMetrics(businessId: string): DailyMetric[] {
  const factor = businessId === 'demo-dms' ? .64 : 1;
  return Array.from({length: 60}, (_, i) => {
    const date = new Date(Date.UTC(2026, 6, 9 + i)).toISOString().slice(0,10);
    const revenue = Math.round((5700 + i * 38 + Math.sin(i * 1.7) * 980 + Math.cos(i * .4) * 490) * factor);
    return { date, revenue, adSpend: Math.round(revenue * (.20 + .035 * Math.sin(i))), cogs: Math.round(revenue * .34), expenses: Math.round(revenue * .08), orders: Math.round(revenue / 136), leads: Math.round(revenue / 470), sessions: Math.round(revenue / 3.8) };
  });
}
