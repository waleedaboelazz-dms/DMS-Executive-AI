import { z } from 'zod';
import type { DailyMetric } from '../metrics/engine';
import { ledgerWindow,roundMoney,shiftDay } from './finance';
const keys=['revenue','adSpend','cogs','expenses'] as const;
type Key=typeof keys[number];
export type ForecastMethod='mean7'|'seasonal7';
export function predictSeries(values:number[],horizon:number,method:ForecastMethod){
  if(values.length<7||values.some(v=>!Number.isFinite(v)||v<0)||!Number.isInteger(horizon)||horizon<1||horizon>30)throw Error('INVALID_FORECAST_INPUT');
  const week=values.slice(-7),mean=week.reduce((a,b)=>a+b,0)/7;
  return Array.from({length:horizon},(_,i)=>roundMoney(method==='mean7'?mean:week[i%7]));
}
function accuracy(actual:number[],predicted:number[]){const absolute=actual.map((v,i)=>Math.abs(v-predicted[i]));const sum=actual.reduce((a,b)=>a+Math.abs(b),0);return {mae:roundMoney(absolute.reduce((a,b)=>a+b,0)/actual.length),wape:sum?absolute.reduce((a,b)=>a+b,0)/sum*100:null,absoluteError:roundMoney(absolute.reduce((a,b)=>a+b,0)),actualTotal:roundMoney(sum)};}
export type ForecastResult={status:'ready'|'insufficient_history'|'missing_days';end:string;horizon:7|30;requiredDays:number;observedDays:number;trainingFrom:string|null;points:{date:string;revenue:number;adSpend:number;cogs:number;expenses:number;profit:number}[];totals:{revenue:number;adSpend:number;cogs:number;expenses:number;profit:number}|null;series:Partial<Record<Key,{method:ForecastMethod;validationMae:Record<ForecastMethod,number>;holdout:ReturnType<typeof accuracy>}>>;holdoutPeriod:{from:string;to:string}|null;limitations:string[]};
export function forecastLedger(rows:DailyMetric[],end:string,horizon:7|30=7):ForecastResult{
  z.union([z.literal(7),z.literal(30)]).parse(horizon);z.iso.date().parse(end);
  const requiredDays=28+2*horizon+6,window=ledgerWindow(rows,end,180);
  let start=end;const dates=new Set(window.rows.map(r=>r.date));let consecutive=0;
  while(consecutive<180&&dates.has(start)){consecutive++;start=shiftDay(start,-1);}
  const result:ForecastResult={status:'insufficient_history',end,horizon,requiredDays,observedDays:consecutive,trainingFrom:null,points:[],totals:null,series:{},holdoutPeriod:null,limitations:['Baseline projections, not guaranteed outcomes or causal predictions.','Model selection uses seven rolling origins before a separate final holdout window.','Holdout error comes from one historical window; it is not a calibrated confidence probability.','No holidays, campaigns, inventory changes or unentered costs are modeled.','Profit is derived from independently forecast revenue and costs; no cash-flow forecast is available.']};
  if(consecutive<requiredDays){result.status=window.rows.length>=requiredDays?'missing_days':'insufficient_history';return result;}
  const history=window.rows.filter(r=>r.date>start),n=history.length,forecast={} as Record<Key,number[]>;
  for(const key of keys){
    const values=history.map(r=>r[key]),scores={} as Record<ForecastMethod,number>;
    for(const method of ['mean7','seasonal7'] as const){let error=0;
      // All selection targets precede the untouched holdout. No future data enters training.
      for(let origin=n-2*horizon-6;origin<=n-2*horizon;origin++)error+=accuracy(values.slice(origin,origin+horizon),predictSeries(values.slice(0,origin),horizon,method)).mae;
      scores[method]=roundMoney(error/7);
    }
    const method:ForecastMethod=scores.seasonal7<scores.mean7?'seasonal7':'mean7';
    const holdout=accuracy(values.slice(n-horizon),predictSeries(values.slice(0,n-horizon),horizon,method));
    result.series[key]={method,validationMae:scores,holdout};forecast[key]=predictSeries(values,horizon,method);
  }
  result.status='ready';result.trainingFrom=history[0].date;result.holdoutPeriod={from:shiftDay(end,1-horizon),to:end};
  result.points=Array.from({length:horizon},(_,i)=>{const amounts={revenue:forecast.revenue[i],adSpend:forecast.adSpend[i],cogs:forecast.cogs[i],expenses:forecast.expenses[i]};return {date:shiftDay(end,i+1),...amounts,profit:roundMoney(amounts.revenue-amounts.adSpend-amounts.cogs-amounts.expenses)};});
  const sum=(key:Key|'profit')=>roundMoney(result.points.reduce((a,p)=>a+p[key],0));
  result.totals={revenue:sum('revenue'),adSpend:sum('adSpend'),cogs:sum('cogs'),expenses:sum('expenses'),profit:sum('profit')};return result;
}
