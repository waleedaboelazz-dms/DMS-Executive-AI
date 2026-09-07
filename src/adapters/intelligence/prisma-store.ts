import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireBusiness,requireWrite,aiLimit } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { metricsRepository } from '@/adapters/prisma';
import { sourceSummaries } from '@/adapters/integrations/prisma-store';
import { financialIntelligence } from '@/modules/intelligence/finance';
import { forecastLedger } from '@/modules/intelligence/forecast';
import { completedDay } from '@/modules/operations/service';
import type { IntelligenceStore } from '@/modules/intelligence/service';
import type { TenantContext } from '@/modules/platform/contracts';
import type { TeamResult } from '@/modules/intelligence/agents';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const intelligenceStore:IntelligenceStore={
  async snapshot(businessId,tenant,options){
    const business=await requireBusiness(businessId,tenant),end=completedDay(business.timezone),today=new Date(Date.parse(end)+86400000);
    const [rows,sources,openTasks,overdueTasks,pendingApprovals,unresolvedAlerts]=await Promise.all([
      metricsRepository.list(businessId,tenant),sourceSummaries(businessId,tenant),
      db.task.count({where:{businessId,status:{in:['open','in_progress']}}}),
      db.task.count({where:{businessId,status:{in:['open','in_progress']},dueAt:{lt:today}}}),
      db.approval.count({where:{businessId,status:'pending'}}),db.alert.count({where:{businessId,resolvedAt:null}})
    ]);
    return {asOf:new Date().toISOString(),currency:business.currency,finance:financialIntelligence(rows,end,options.days),forecast:forecastLedger(rows,end,options.horizon),operations:{openTasks,overdueTasks,pendingApprovals,unresolvedAlerts},sources};
  },
  async reserve(businessId,tenant){
    requireWrite(tenant);await requireBusiness(businessId,tenant);
    const membership=await db.membership.findUnique({where:{userId_organizationId:{userId:tenant.userId,organizationId:tenant.organizationId}}});
    if(!membership)throw new HttpError(403,'Workspace membership required');requireWrite({...tenant,role:membership.role});
    await aiLimit(tenant,5);
  },
  async save(businessId,tenant,result,snapshot){
    return db.$transaction(async tx=>{
      const business=await tx.business.findFirst({where:{id:businessId,organizationId:tenant.organizationId}}),membership=await tx.membership.findUnique({where:{userId_organizationId:{userId:tenant.userId,organizationId:tenant.organizationId}}});
      if(!business||!membership)throw new HttpError(403,'Workspace access no longer available');requireWrite({...tenant,role:membership.role});
      const insight=await tx.aiInsight.create({data:{businessId,agent:'executive-team-v1',content:JSON.stringify(result),evidence:json(snapshot)}});
      await tx.auditLog.create({data:{businessId,userId:tenant.userId,action:'ai.team_review',reason:'User requested specialist review',result:`${result.status}:${insight.id}`}});
      return {id:insight.id};
    });
  }
};
export async function intelligenceHistory(businessId:string,tenant:TenantContext){
  await requireBusiness(businessId,tenant);
  const entries=await db.aiInsight.findMany({where:{businessId,agent:'executive-team-v1'},orderBy:{createdAt:'desc'},take:10});
  return entries.map(entry=>({id:entry.id,createdAt:entry.createdAt.toISOString(),result:JSON.parse(entry.content) as TeamResult}));
}
