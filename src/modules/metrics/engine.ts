import { z } from 'zod';
const money = z.number().finite().min(0).max(1_000_000_000).multipleOf(0.01);
export const metricSchema = z.object({ date: z.iso.date(), revenue: money, adSpend: money, cogs: money, expenses: money, orders: z.number().int().min(0).max(10_000_000), leads: z.number().int().min(0).max(10_000_000), sessions: z.number().int().min(0).max(100_000_000) });
export type DailyMetric = z.infer<typeof metricSchema>;
export function aggregate(rows: DailyMetric[]) {
  const sumMoney = (key:'revenue'|'adSpend'|'cogs'|'expenses') => rows.reduce((sum,row)=>sum+Math.round(row[key]*100),0)/100;
  const counts = rows.reduce((a,r)=>({orders:a.orders+r.orders,leads:a.leads+r.leads,sessions:a.sessions+r.sessions}),{orders:0,leads:0,sessions:0});
  const total={...counts,revenue:sumMoney('revenue'),adSpend:sumMoney('adSpend'),cogs:sumMoney('cogs'),expenses:sumMoney('expenses')};
  const profit = Math.round((total.revenue - total.adSpend - total.cogs - total.expenses)*100)/100;
  return { ...total, profit, roas: total.adSpend ? total.revenue / total.adSpend : null, margin: total.revenue ? profit / total.revenue * 100 : null, conversion: total.sessions ? total.orders / total.sessions * 100 : null, aov: total.orders ? total.revenue / total.orders : null, days: rows.length };
}
export function change(current: number, previous: number): number | null { return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100; }
export function periods(rows: DailyMetric[], days: number) {
  const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { current: [], previous: [], end: null };
  const end = new Date(sorted.at(-1)!.date + 'T00:00:00Z').getTime();
  const day = 86_400_000;
  return { current: sorted.filter(r => Date.parse(r.date) > end - days * day), previous: sorted.filter(r => Date.parse(r.date) <= end - days * day && Date.parse(r.date) > end - 2 * days * day), end: sorted.at(-1)!.date };
}
export function health(rows: DailyMetric[]) {
  const m = aggregate(rows);
  if (!rows.length || !m.revenue) return null;
  // Partial health: only measurable financial factors, not fabricated customer/IT scores.
  const profitability = Math.min(100, Math.max(0, (m.margin ?? 0) / 40 * 100));
  const efficiency = m.roas === null ? null : Math.min(100, Math.max(0, m.roas / 5 * 100));
  return { score: Math.round(efficiency === null ? profitability : profitability * .6 + efficiency * .4), profitability: Math.round(profitability), efficiency: efficiency === null ? null : Math.round(efficiency), coverage: 'finance-and-marketing-only' };
}
export function contextFor(rows: DailyMetric[], days: number) {
  const p = periods(rows, days), current = aggregate(p.current), previous = aggregate(p.previous);
  return { periodDays: days, periodEnd: p.end, observedDays: p.current.length, comparisonDays: p.previous.length, current, previous, revenueChange: p.current.length === days && p.previous.length === days ? change(current.revenue, previous.revenue) : null, health: health(p.current), caveats: ['ROAS is blended revenue / spend, not channel attribution.', 'Profit excludes costs not entered; missing days are not zero-sales days.', 'Health covers finance and marketing only. Causation cannot be inferred from daily totals.'] };
}
export function reportText(rows: DailyMetric[], days: number, language: 'ar' | 'en') {
  const c = contextFor(rows, days), m = c.current;
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (!m.days) return language === 'ar' ? 'لا توجد بيانات للفترة المحددة. أضف البيانات اليومية أولًا.' : 'No data for this period. Add daily metrics first.';
  return language === 'ar' ? `التقرير التنفيذي • حتى ${c.periodEnd}\n\nالإيرادات: ${n(m.revenue)} ر.س\nالطلبات: ${m.orders}\nالإنفاق الإعلاني: ${n(m.adSpend)} ر.س\nالربح التقديري: ${n(m.profit)} ر.س\nالعائد المدمج: ${m.roas?.toFixed(2) ?? 'غير متاح'}\n\n${c.revenueChange === null ? 'بيانات المقارنة غير مكتملة.' : `تغير الإيرادات: ${c.revenueChange.toFixed(1)}% مقارنة بالفترة السابقة.`}\n\n${m.profit < 0 ? 'يحتاج الانتباه: التكاليف المدخلة أعلى من الإيرادات. راجع تكلفة المنتجات والإنفاق.' : 'النتيجة: الإيرادات تغطي التكاليف المدخلة. راجع المصروفات غير المسجلة قبل اتخاذ قرار.'}\n\nالتغطية: ${m.days} من ${days} أيام. لا يمكن تحديد سبب التغير دون بيانات القنوات. هذا تقرير حسابي، وليس تحليلًا مولدًا بالذكاء الاصطناعي.` : `Executive report • through ${c.periodEnd}\n\nRevenue: SAR ${n(m.revenue)}\nOrders: ${m.orders}\nAd spend: SAR ${n(m.adSpend)}\nEstimated net profit: SAR ${n(m.profit)}\nBlended ROAS: ${m.roas?.toFixed(2) ?? 'N/A'}x\n\n${c.revenueChange === null ? 'Comparison data is incomplete.' : `Revenue changed ${c.revenueChange.toFixed(1)}% versus the preceding period.`}\n\n${m.profit < 0 ? 'Needs attention: entered costs exceed revenue. Review product costs and spend.' : 'Revenue covers entered costs. Verify unrecorded expenses before making decisions.'}\n\nCoverage: ${m.days}/${days} days. Channel data is required to investigate causes. This is a calculated report, not AI-generated analysis.`;
}
