import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireBusiness, requireWrite } from '@/lib/auth';
import type { MetricsRepository, ReportRepository } from '@/modules/platform/contracts';
import type { BusinessRepository } from '@/modules/businesses/service';
import { HttpError } from '@/lib/http';
export const businessRepository:BusinessRepository={
  list(tenant){return db.business.findMany({where:{organizationId:tenant.organizationId},orderBy:{createdAt:'asc'}});},
  async create(tenant,name){requireWrite(tenant);return db.$transaction(async tx=>{const business=await tx.business.create({data:{name,organizationId:tenant.organizationId}});await tx.auditLog.create({data:{businessId:business.id,userId:tenant.userId,action:'business.create',reason:'User request',result:'created'}});return business;});},
  async provision(userId,name){return db.$transaction(async tx=>{
    await tx.user.upsert({where:{id:userId},create:{id:userId},update:{}});
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if(await tx.membership.findFirst({where:{userId}}))throw new HttpError(409,'Workspace already exists');
    const org=await tx.organization.create({data:{name,memberships:{create:{userId,role:'owner'}}}});
    const business=await tx.business.create({data:{name,organizationId:org.id}});
    await tx.auditLog.create({data:{businessId:business.id,userId,action:'workspace.provision',reason:'First sign-in setup',result:'created'}});
    return business;
  });},
};
export const metricsRepository: MetricsRepository = {
  async list(businessId, tenant) { await requireBusiness(businessId, tenant); const rows = await db.metric.findMany({ where: { businessId }, orderBy: { date: 'desc' }, take: 366 }); return rows.map(r => ({ date: r.date.toISOString().slice(0,10), revenue: Number(r.revenue), adSpend: Number(r.adSpend), cogs: Number(r.cogs), expenses: Number(r.expenses), orders: r.orders, leads: r.leads, sessions: r.sessions })); },
  async save(businessId, tenant, metric) { requireWrite(tenant); await requireBusiness(businessId, tenant); const data = { ...metric, date: new Date(metric.date + 'T00:00:00Z') }; await db.$transaction([db.metric.upsert({ where: { businessId_date: { businessId, date: data.date } }, create: { businessId, ...data }, update: data }), db.auditLog.create({ data: { businessId, userId: tenant.userId, action: 'metrics.upsert', reason: `Manual daily input ${metric.date}`, result: 'saved' } })]); },
};
export const reportRepository: ReportRepository = { async save(input) { requireWrite(input.tenant); await requireBusiness(input.businessId, input.tenant); return db.$transaction(async tx => { const report = await tx.report.create({ data: { businessId: input.businessId, title: input.title, content: input.content, kind: input.kind, context: input.context as Prisma.InputJsonValue } }); await tx.auditLog.create({ data: { businessId: input.businessId, userId: input.tenant.userId, action: 'report.create', reason: input.kind, result: report.id } }); return { id: report.id }; }); } };
