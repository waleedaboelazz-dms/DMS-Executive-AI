import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireBusiness } from '@/lib/auth';
import type { TenantContext } from '@/modules/platform/contracts';
import { authorizeOperation, completedDay, evaluateCondition, OperationsError, OperationsService, taskInput, conditionInput, type Operation, type OperationsStore } from '@/modules/operations/service';

const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const operationsStore:OperationsStore={
  async list(businessId,tenant){
    await requireBusiness(businessId,tenant);
    const [tasks,alerts,approvals,rules,audit]=await Promise.all([
      db.task.findMany({where:{businessId},orderBy:{createdAt:'desc'},take:100}),
      db.alert.findMany({where:{businessId},orderBy:{createdAt:'desc'},take:100}),
      db.approval.findMany({where:{businessId},orderBy:{createdAt:'desc'},take:100}),
      db.automationRule.findMany({where:{businessId},orderBy:{createdAt:'desc'},take:100,include:{evaluations:{orderBy:{createdAt:'desc'},take:1}}}),
      db.auditLog.findMany({where:{businessId,action:{startsWith:'operations.'}},orderBy:{createdAt:'desc'},take:50})
    ]);
    return {tasks,alerts,approvals,rules,audit,canWrite:['owner','admin','member'].includes(tenant.role),canManage:['owner','admin'].includes(tenant.role),workerConfigured:Boolean(process.env.REDIS_URL)};
  },
  async apply(businessId,tenant,operation){
    return db.$transaction(async tx=>{
      // All operations for one business serialize, including automation and approval execution.
      const businesses=await tx.$queryRaw<{id:string;timezone:string}[]>`SELECT id,timezone FROM businesses WHERE id=${businessId} AND organizationId=${tenant.organizationId} FOR UPDATE`;
      if(!businesses.length)throw new OperationsError(404,'Business not found');
      const membership=await tx.membership.findUnique({where:{userId_organizationId:{userId:tenant.userId,organizationId:tenant.organizationId}}});
      if(!membership)throw new OperationsError(403,'Workspace membership required');
      authorizeOperation({...tenant,role:membership.role},operation);
      const audit=async(action:string,reason:string,result:string)=>{await tx.auditLog.create({data:{businessId,userId:tenant.userId,action:`operations.${action}`,reason,result}});};
      const createTask=async(task:unknown,sourceKey?:string)=>{const input=taskInput.parse(task);return tx.task.create({data:{businessId,title:input.title,priority:input.priority,dueAt:input.dueDate?new Date(`${input.dueDate}T00:00:00Z`):null,sourceKey}});};
      const requestApproval=async(task:unknown,reason:string)=>{const payload={task:taskInput.parse(task),reason};return tx.approval.create({data:{businessId,actionType:'create_task',immutablePayload:json(payload),payloadHash:hash(payload),requestedBy:tenant.userId}});};
      if(operation.operation==='create_task'){const task=await createTask(operation.task);await audit('create_task',task.title,task.id);return task;}
      if(operation.operation==='task_status'){
        const task=await tx.task.findFirst({where:{id:operation.id,businessId}});if(!task)throw new OperationsError(404,'Task not found');
        const result=await tx.task.update({where:{id:task.id},data:{status:operation.status}});await audit('task_status',`${task.status} → ${operation.status}`,task.id);return result;
      }
      if(operation.operation==='request_approval'){const approval=await requestApproval(operation.task,operation.reason);await audit('request_approval',operation.reason,approval.id);return approval;}
      if(operation.operation==='decide'){
        const approval=await tx.approval.findFirst({where:{id:operation.id,businessId}});if(!approval)throw new OperationsError(404,'Approval not found');
        if(approval.status!=='pending')throw new OperationsError(409,'This request has already been decided');
        if(approval.actionType!=='create_task')throw new OperationsError(422,'No executor is available for this action');
        const payload=approval.immutablePayload as {task:unknown;reason:string};
        // PostgreSQL JSONB changes object key order, so reconstruct the validated canonical envelope.
        const canonical={task:taskInput.parse(payload.task),reason:payload.reason};
        if(hash(canonical)!==approval.payloadHash)throw new OperationsError(409,'Approval payload integrity check failed');
        let taskId:string|null=null;
        if(operation.decision==='approve')taskId=(await createTask(canonical.task,`approval:${approval.id}`)).id;
        const result=await tx.approval.update({where:{id:approval.id},data:{status:taskId?'executed':'rejected',decidedBy:tenant.userId,decidedAt:new Date(),executionKey:taskId?`approval:${approval.id}`:null,executedAt:taskId?new Date():null}});
        await audit(`approval_${operation.decision}`,operation.reason,`${approval.id}${taskId?` task:${taskId}`:''}`);return result;
      }
      if(operation.operation==='resolve_alert'||operation.operation==='alert_task'){
        const alert=await tx.alert.findFirst({where:{id:operation.id,businessId}});if(!alert)throw new OperationsError(404,'Alert not found');
        if(operation.operation==='resolve_alert'){await tx.alert.update({where:{id:alert.id},data:{resolvedAt:new Date()}});await audit('resolve_alert',alert.title,alert.id);return {id:alert.id};}
        const existing=await tx.task.findUnique({where:{sourceKey:`alert:${alert.id}`}});if(existing)return existing;
        const task=await createTask({title:alert.title,priority:'high'},`alert:${alert.id}`);await audit('alert_task',alert.title,task.id);return task;
      }
      if(operation.operation==='create_rule'){
        if(await tx.automationRule.count({where:{businessId}})>=100)throw new OperationsError(422,'Maximum 100 rules per business');
        const rule=await tx.automationRule.create({data:{businessId,name:operation.rule.name,condition:json(operation.rule.condition),action:{type:operation.rule.action},enabled:false}});await audit('create_rule',rule.name,rule.id);return rule;
      }
      if(operation.operation==='toggle_rule'){
        const rule=await tx.automationRule.findFirst({where:{id:operation.id,businessId}});if(!rule)throw new OperationsError(404,'Rule not found');
        const result=await tx.automationRule.update({where:{id:rule.id},data:{enabled:operation.enabled}});await audit('toggle_rule',String(operation.enabled),rule.id);return result;
      }
      const end=completedDay(businesses[0].timezone);
      const records=await tx.metric.findMany({where:{businessId,date:{lte:new Date(end),gte:new Date(Date.parse(end)-29*86400000)}}});
      const rows=records.map(row=>({...row,date:row.date.toISOString().slice(0,10),revenue:Number(row.revenue),adSpend:Number(row.adSpend),cogs:Number(row.cogs),expenses:Number(row.expenses)}));
      const rules=await tx.automationRule.findMany({where:{businessId,enabled:true},take:100});let triggered=0;
      for(const rule of rules){
        const key={ruleId:rule.id,periodEnd:new Date(end)};
        const previous=await tx.automationEvaluation.findUnique({where:{ruleId_periodEnd:key}});
        await tx.automationRule.update({where:{id:rule.id},data:{lastEvaluatedAt:new Date()}});
        if(previous?.matched)continue;
        const evidence=evaluateCondition(conditionInput.parse(rule.condition),rows,end);
        await tx.automationEvaluation.upsert({where:{ruleId_periodEnd:key},create:{...key,matched:evidence.matched,evidence:json(evidence)},update:{matched:evidence.matched,evidence:json(evidence)}});
        if(!evidence.matched)continue;
        const alert=await tx.alert.create({data:{businessId,title:rule.name,severity:'warning',evidence:json(evidence)}});
        if((rule.action as {type:string}).type==='task_approval')await requestApproval({title:rule.name,priority:'high'},`Automation ${rule.id}; manual ledger ${evidence.from} to ${end}; alert ${alert.id}`);
        await audit('rule_triggered',rule.name,`${rule.id} alert:${alert.id} period:${end}`);triggered++;
      }
      return {evaluated:rules.length,triggered,periodEnd:end};
    },{timeout:20000});
  }
};
export const operationsService=new OperationsService(operationsStore);

export async function evaluateScheduledOperations(){
  const due=await db.automationRule.findMany({where:{enabled:true,OR:[{lastEvaluatedAt:null},{lastEvaluatedAt:{lt:new Date(Date.now()-3600000)}}]},select:{businessId:true},distinct:['businessId'],take:50});
  for(const item of due){
    const business=await db.business.findUniqueOrThrow({where:{id:item.businessId}});
    const member=await db.membership.findFirst({where:{organizationId:business.organizationId,role:{in:['owner','admin']}}});
    if(member)await operationsService.execute(item.businessId,{userId:member.userId,organizationId:member.organizationId,role:member.role},{operation:'evaluate'});
  }
}
