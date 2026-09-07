import { evaluateCondition, operationInput, type Operation, type RuleCondition } from './service';
import type { DailyMetric } from '../metrics/engine';
export type TaskView={id:string;title:string;priority:string;status:string;dueAt:string|null;sourceKey?:string|null};
export type AlertView={id:string;title:string;resolvedAt:string|null;evidence:unknown};
export type ApprovalView={id:string;status:string;immutablePayload:{task:{title:string;priority:string;dueDate:string|null};reason:string};createdAt?:string};
export type RuleView={id:string;name:string;enabled:boolean;condition:RuleCondition;action:{type:string};lastEvaluatedAt?:string|null;evaluations?:{evidence:unknown;matched:boolean}[]};
export type OperationsView={tasks:TaskView[];alerts:AlertView[];approvals:ApprovalView[];rules:RuleView[];audit:{id:string;action:string;reason:string;result:string;createdAt:string}[];canWrite:boolean;canManage:boolean;workerConfigured:boolean;demoRuns?:string[]};
export function emptyOperations():OperationsView{return {tasks:[],alerts:[],approvals:[],rules:[],audit:[],canWrite:true,canManage:true,workerConfigured:false,demoRuns:[]};}
// Browser-only demo host. No credentials, remote execution or server persistence.
export function applyDemoOperation(previous:OperationsView,input:Operation,rows:DailyMetric[]):OperationsView{
  const op=operationInput.parse(input),state=structuredClone(previous),now=new Date().toISOString();
  const addTask=(task:ApprovalView['immutablePayload']['task'],sourceKey?:string)=>{if(sourceKey&&state.tasks.some(t=>t.sourceKey===sourceKey))return;state.tasks.unshift({id:crypto.randomUUID(),...task,dueAt:task.dueDate,status:'open',sourceKey});};
  const approve=(task:ApprovalView['immutablePayload']['task'],reason:string)=>state.approvals.unshift({id:crypto.randomUUID(),status:'pending',immutablePayload:{task,reason},createdAt:now});
  if(op.operation==='create_task')addTask(op.task);
  if(op.operation==='request_approval')approve(op.task,op.reason);
  if(op.operation==='task_status'){const task=state.tasks.find(t=>t.id===op.id);if(!task)throw Error('Task not found');task.status=op.status;}
  if(op.operation==='decide'){const request=state.approvals.find(a=>a.id===op.id);if(!request||request.status!=='pending')throw Error('Request already decided');request.status=op.decision==='approve'?'executed':'rejected';if(op.decision==='approve')addTask(request.immutablePayload.task,`approval:${request.id}`);}
  if(op.operation==='resolve_alert'||op.operation==='alert_task'){const alert=state.alerts.find(a=>a.id===op.id);if(!alert)throw Error('Alert not found');if(op.operation==='resolve_alert')alert.resolvedAt=now;else addTask({title:alert.title,priority:'high',dueDate:null},`alert:${alert.id}`);}
  if(op.operation==='create_rule')state.rules.unshift({id:crypto.randomUUID(),name:op.rule.name,condition:op.rule.condition,action:{type:op.rule.action},enabled:false});
  if(op.operation==='toggle_rule'){const rule=state.rules.find(r=>r.id===op.id);if(!rule)throw Error('Rule not found');rule.enabled=op.enabled;}
  if(op.operation==='evaluate'){
    const end=rows.map(r=>r.date).sort().at(-1);if(!end)throw Error('Add daily data first');
    for(const rule of state.rules.filter(r=>r.enabled)){
      const key=`${rule.id}:${end}`;if(state.demoRuns?.includes(key))continue;
      const evidence=evaluateCondition(rule.condition,rows,end);rule.evaluations=[{evidence,matched:evidence.matched}];rule.lastEvaluatedAt=now;
      if(!evidence.matched)continue;(state.demoRuns??=[]).push(key);
      state.alerts.unshift({id:crypto.randomUUID(),title:rule.name,resolvedAt:null,evidence});
      if(rule.action.type==='task_approval')approve({title:rule.name,priority:'high',dueDate:null},`Demo manual ledger ${evidence.from} → ${end}`);
    }
  }
  state.audit.unshift({id:crypto.randomUUID(),action:`operations.${op.operation}`,reason:'Demo action',result:'Saved in this browser',createdAt:now});
  return state;
}
