import { z } from 'zod';
import { aggregate,change,metricSchema,type DailyMetric } from '../metrics/engine';
export const shiftDay=(date:string,days:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
export const roundMoney=(n:number)=>Math.round(n*100)/100;
export function ledgerWindow(rows:DailyMetric[],end:string,days:number){
  z.iso.date().parse(end);z.number().int().min(1).max(366).parse(days);
  const from=shiftDay(end,1-days),window=rows.filter(r=>r.date>=from&&r.date<=end).map(r=>metricSchema.parse(r));
  if(new Set(window.map(r=>r.date)).size!==window.length)throw Error('DUPLICATE_LEDGER_DAY');
  return {from,to:end,rows:window.sort((a,b)=>a.date.localeCompare(b.date)),observedDays:window.length,expectedDays:days,complete:window.length===days};
}
export const scenarioInput=z.object({revenuePercent:z.number().min(-100).max(100).default(0),adSpendPercent:z.number().min(-100).max(100).default(0),cogsPercent:z.number().min(-100).max(100).default(0),expensesPercent:z.number().min(-100).max(100).default(0)});
export function scenario(base:{revenue:number;adSpend:number;cogs:number;expenses:number},input:z.input<typeof scenarioInput>){
  const p=scenarioInput.parse(input),revenue=roundMoney(base.revenue*(1+p.revenuePercent/100)),adSpend=roundMoney(base.adSpend*(1+p.adSpendPercent/100)),cogs=roundMoney(base.cogs*(1+p.cogsPercent/100)),expenses=roundMoney(base.expenses*(1+p.expensesPercent/100));
  const profit=roundMoney(revenue-adSpend-cogs-expenses);
  return {revenue,adSpend,cogs,expenses,profit,margin:revenue?profit/revenue*100:null,profitChange:roundMoney(profit-(base.revenue-base.adSpend-base.cogs-base.expenses))};
}
export function financialIntelligence(rows:DailyMetric[],end:string,days=30){
  const current=ledgerWindow(rows,end,days),previous=ledgerWindow(rows,shiftDay(end,-days),days),m=aggregate(current.rows),p=aggregate(previous.rows);
  return {source:'manual-ledger',period:{from:current.from,to:end,observedDays:current.observedDays,expectedDays:days,complete:current.complete},previousPeriod:{from:previous.from,to:previous.to,observedDays:previous.observedDays,complete:previous.complete},totals:m,
    grossProfit:roundMoney(m.revenue-m.cogs),grossMargin:m.revenue?(m.revenue-m.cogs)/m.revenue*100:null,
    costShare:m.revenue?{cogs:m.cogs/m.revenue*100,advertising:m.adSpend/m.revenue*100,expenses:m.expenses/m.revenue*100}:null,
    // Static cost coverage, not a fixed/variable-cost model or a recommendation to spend.
    costCoverageRevenue:roundMoney(m.cogs+m.adSpend+m.expenses),adSpendAtZeroProfit:roundMoney(m.revenue-m.cogs-m.expenses),
    revenueChange:current.complete&&previous.complete?change(m.revenue,p.revenue):null,
    profitBridge:current.complete&&previous.complete?{previousProfit:p.profit,revenue:roundMoney(m.revenue-p.revenue),cogs:roundMoney(p.cogs-m.cogs),adSpend:roundMoney(p.adSpend-m.adSpend),expenses:roundMoney(p.expenses-m.expenses),currentProfit:m.profit}:null,
    limitations:['Entered costs only; unentered costs and tax liabilities are unknown.','Profit is not cash flow. No bank balances, receivables or payment timing are available.','Cost coverage assumes entered costs stay fixed; it is not a volume-based break-even model.']};
}
export type FinancialIntelligence=ReturnType<typeof financialIntelligence>;
