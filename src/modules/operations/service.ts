import { z } from 'zod';
import { aggregate, type DailyMetric } from '../metrics/engine';
import type { TenantContext } from '../platform/contracts';

export const taskInput = z.object({ title:z.string().trim().min(1).max(200), priority:z.enum(['normal','high','urgent']).default('normal'), dueDate:z.iso.date().nullable().default(null) }).strict();
export const conditionInput = z.object({ metric:z.enum(['roas','profit','revenue','orders','conversion']), operator:z.enum(['lt','gt']), threshold:z.number().finite().min(-1e9).max(1e9), days:z.number().int().min(1).max(30) }).strict();
export const ruleInput = z.object({name:z.string().trim().min(1).max(120),condition:conditionInput,action:z.enum(['alert','task_approval'])}).strict();
const id=z.string().min(1).max(128);
export const operationInput=z.discriminatedUnion('operation',[
  z.object({operation:z.literal('create_task'),task:taskInput}),
  z.object({operation:z.literal('task_status'),id,status:z.enum(['open','in_progress','done'])}),
  z.object({operation:z.literal('request_approval'),task:taskInput,reason:z.string().trim().min(1).max(1000)}),
  z.object({operation:z.literal('decide'),id,decision:z.enum(['approve','reject']),reason:z.string().trim().min(1).max(1000)}),
  z.object({operation:z.literal('resolve_alert'),id}),
  z.object({operation:z.literal('alert_task'),id}),
  z.object({operation:z.literal('create_rule'),rule:ruleInput}),
  z.object({operation:z.literal('toggle_rule'),id,enabled:z.boolean()}),
  z.object({operation:z.literal('evaluate')})
]);
export type Operation=z.infer<typeof operationInput>;
export type RuleCondition=z.infer<typeof conditionInput>;
export class OperationsError extends Error { constructor(public status:number,message:string){super(message);} }
export function authorizeOperation(context:TenantContext,operation:Operation){
  if(!['owner','admin','member'].includes(context.role))throw new OperationsError(403,'Read-only workspace membership');
  if(['decide','create_rule','toggle_rule','evaluate'].includes(operation.operation)&&!['owner','admin'].includes(context.role))throw new OperationsError(403,'Owner or admin permission required');
}
export function previousDay(date:string){return new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10);}
export function completedDay(timezone:string,now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  return previousDay(`${part('year')}-${part('month')}-${part('day')}`);
}
// Each completed calendar day must satisfy the condition. Missing/undefined data cannot trigger an action.
export function evaluateCondition(input:RuleCondition,rows:DailyMetric[],end:string){
  const condition=conditionInput.parse(input);z.iso.date().parse(end);
  const dates:string[]=[];let date=end;for(let i=0;i<condition.days;i++){dates.unshift(date);date=previousDay(date);}
  const observations=dates.map(date=>{const matches=rows.filter(row=>row.date===date);return {date,value:matches.length===1?aggregate(matches)[condition.metric]:null};});
  const complete=observations.every(o=>o.value!==null&&Number.isFinite(o.value));
  return {source:'manual-ledger',from:dates[0],to:end,condition,observations,complete,matched:complete&&observations.every(o=>condition.operator==='lt'?o.value!<condition.threshold:o.value!>condition.threshold)};
}
export interface OperationsStore {
  list(businessId:string,tenant:TenantContext):Promise<unknown>;
  apply(businessId:string,tenant:TenantContext,operation:Operation):Promise<unknown>;
}
export class OperationsService {
  constructor(private store:OperationsStore){}
  list(businessId:string,tenant:TenantContext){return this.store.list(businessId,tenant);}
  execute(businessId:string,tenant:TenantContext,input:unknown){const operation=operationInput.parse(input);authorizeOperation(tenant,operation);return this.store.apply(businessId,tenant,operation);}
}
