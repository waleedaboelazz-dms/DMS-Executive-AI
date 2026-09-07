import { aggregate, periods, type DailyMetric } from '../metrics/engine';
export type MetricAlert = { code:'negative-profit'|'low-roas'|'missing-days'|'no-data'; severity:'warning'|'info'; observed:number; threshold:number };
export function detectMetricAlerts(rows:DailyMetric[], days:number):MetricAlert[] {
  const current=periods(rows,days).current, metrics=aggregate(current);
  if(!metrics.days)return[{code:'no-data',severity:'info',observed:0,threshold:1}];
  const alerts:MetricAlert[]=[];
  if(metrics.profit<0)alerts.push({code:'negative-profit',severity:'warning',observed:metrics.profit,threshold:0});
  if(metrics.roas!==null&&metrics.roas<2)alerts.push({code:'low-roas',severity:'warning',observed:metrics.roas,threshold:2});
  if(current.length<days)alerts.push({code:'missing-days',severity:'info',observed:current.length,threshold:days});
  return alerts;
}
