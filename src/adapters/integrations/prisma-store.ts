import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireBusiness } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { encryptCredential,decryptCredential } from '@/lib/crypto';
import { connectionSchema,providerSchema,sourceMetricSchema,summarizeSource,type SourceMetric,type SourceSummary,type CatalogResult } from '@/modules/integrations/types';
import type { IntegrationStore,SyncClaim } from '@/modules/integrations/service';
import type { TenantContext } from '@/modules/platform/contracts';
const date=(value:string)=>new Date(value+'T00:00:00Z');
export async function integrationAccess(businessId:string,tenant:TenantContext){if(!['owner','admin'].includes(tenant.role))throw new HttpError(403,'Only an owner or admin can manage connections');await requireBusiness(businessId,tenant);}
async function locked(tx:Prisma.TransactionClient,integrationId:string){await tx.$queryRaw`SELECT id FROM integrations WHERE id=${integrationId} FOR UPDATE`;}
async function fence(tx:Prisma.TransactionClient,claim:SyncClaim){await locked(tx,claim.integrationId);const current=await tx.integration.findUnique({where:{id:claim.integrationId}});if(!current||current.version!==claim.version||current.syncOwner!==claim.owner||current.status!=='connected')throw new HttpError(409,'Connection changed during synchronization');return current;}
export const integrationStore:IntegrationStore={
  authorize:integrationAccess,
  async connect(businessId,tenant,provider,credentials){await integrationAccess(businessId,tenant);const encryptedValue=encryptCredential(JSON.stringify(credentials));await db.$transaction(async tx=>{
    const integration=await tx.integration.upsert({where:{businessId_provider:{businessId,provider}},create:{businessId,provider},update:{}});await locked(tx,integration.id);
    await tx.integration.update({where:{id:integration.id},data:{status:'connected',accountId:credentials.accountId??null,version:{increment:1},lastSync:null,lastError:null,cursor:null,syncOwner:null,syncLeaseUntil:null}});
    await tx.integrationCredential.upsert({where:{integrationId:integration.id},create:{integrationId:integration.id,encryptedValue},update:{encryptedValue}});
    await tx.syncRun.updateMany({where:{integrationId:integration.id,status:{in:['queued','running','failed']}},data:{status:'cancelled',finishedAt:new Date()}});
    await tx.auditLog.create({data:{businessId,userId:tenant.userId,action:'integration.connect',reason:provider,result:'verified-and-encrypted'}});
  });},
  async disconnect(businessId,tenant,provider){await integrationAccess(businessId,tenant);await db.$transaction(async tx=>{const integration=await tx.integration.findUnique({where:{businessId_provider:{businessId,provider}}});if(!integration)return;await locked(tx,integration.id);await tx.integration.update({where:{id:integration.id},data:{status:'disconnected',version:{increment:1},autoSync:false,syncOwner:null,syncLeaseUntil:null}});await tx.integrationCredential.deleteMany({where:{integrationId:integration.id}});await tx.syncRun.updateMany({where:{integrationId:integration.id,status:{in:['queued','running','failed']}},data:{status:'cancelled',finishedAt:new Date()}});await tx.auditLog.create({data:{businessId,userId:tenant.userId,action:'integration.disconnect',reason:provider,result:'local-credentials-deleted'}});});},
  async request(businessId,tenant,provider,range){await integrationAccess(businessId,tenant);return db.$transaction(async tx=>{
    const integration=await tx.integration.findUnique({where:{businessId_provider:{businessId,provider}}});if(!integration)throw new HttpError(409,'Connect this provider first');await locked(tx,integration.id);const current=await tx.integration.findUniqueOrThrow({where:{id:integration.id}});if(current.status!=='connected')throw new HttpError(409,'Reconnect this provider first');
    const active=await tx.syncRun.findFirst({where:{integrationId:current.id,version:current.version,status:{in:['queued','running']},createdAt:{gt:new Date(Date.now()-20*60000)}}});if(active)return active.id;
    const run=await tx.syncRun.create({data:{integrationId:current.id,version:current.version,requestedBy:tenant.userId,from:date(range.from),to:date(range.to)}});return run.id;
  });},
  async claim(runId){return db.$transaction(async tx=>{
    const run=await tx.syncRun.findUnique({where:{id:runId}});if(!run||['completed','cancelled'].includes(run.status))return null;
    await locked(tx,run.integrationId);const latest=await tx.syncRun.findUniqueOrThrow({where:{id:runId}});if(['completed','cancelled'].includes(latest.status))return null;const integration=await tx.integration.findUniqueOrThrow({where:{id:run.integrationId},include:{credential:true}});
    if(integration.status!=='connected'||integration.version!==run.version||!integration.credential){await tx.syncRun.update({where:{id:runId},data:{status:'cancelled'}});return null;}
    if(integration.syncLeaseUntil&&integration.syncLeaseUntil>new Date())throw new HttpError(409,'Synchronization is already running');
    const owner=randomUUID();await tx.integration.update({where:{id:integration.id},data:{syncOwner:owner,syncLeaseUntil:new Date(Date.now()+15*60000)}});
    await tx.syncRun.update({where:{id:runId},data:{status:'running',attempts:{increment:1},startedAt:new Date(),finishedAt:null,errorCode:null}});
    return {runId,integrationId:integration.id,businessId:integration.businessId,version:integration.version,owner,provider:providerSchema.parse(integration.provider),credentials:connectionSchema.parse(JSON.parse(decryptCredential(integration.credential.encryptedValue))),range:{from:run.from.toISOString().slice(0,10),to:run.to.toISOString().slice(0,10)}};
  });},
  async credential(claim,credentials){await db.$transaction(async tx=>{await fence(tx,claim);await tx.integrationCredential.update({where:{integrationId:claim.integrationId},data:{encryptedValue:encryptCredential(JSON.stringify(credentials))}});});},
  async complete(claim,result){
    const rows=result.rows.map(r=>sourceMetricSchema.parse(r));if(rows.some(r=>r.date<claim.range.from||r.date>claim.range.to))throw new Error('INVALID_RESPONSE');
    await db.$transaction(async tx=>{await fence(tx,claim);
      // Snapshot replacement is atomic; retries do not add revenue again, and removed records disappear.
      await tx.sourceMetric.deleteMany({where:{integrationId:claim.integrationId,version:claim.version,date:{gte:date(claim.range.from),lte:date(claim.range.to)}}});
      if(rows.length)await tx.sourceMetric.createMany({data:rows.map(row=>({integrationId:claim.integrationId,version:claim.version,date:date(row.date),currency:row.currency,values:row as Prisma.InputJsonValue,notes:result.notes,timezone:result.timezone}))});
      await tx.syncRun.update({where:{id:claim.runId},data:{status:'completed',records:result.records,finishedAt:new Date()}});
      await tx.integration.update({where:{id:claim.integrationId},data:{lastSync:new Date(),lastError:null,cursor:claim.range.to,syncOwner:null,syncLeaseUntil:null}});
      await tx.auditLog.create({data:{businessId:claim.businessId,userId:'sync-worker',action:'integration.sync',reason:claim.provider,result:`${claim.runId}: ${result.records} records`}});
    });
  },
  async fail(claim,code){await db.$transaction(async tx=>{await locked(tx,claim.integrationId);const current=await tx.integration.findUnique({where:{id:claim.integrationId}});if(!current||current.version!==claim.version||current.syncOwner!==claim.owner)return;await tx.integration.update({where:{id:claim.integrationId},data:{lastError:code,syncOwner:null,syncLeaseUntil:null,...(code==='AUTH_EXPIRED'?{status:'needs_reconnection'}:{})}});await tx.syncRun.update({where:{id:claim.runId},data:{status:'failed',errorCode:code,finishedAt:new Date()}});await tx.auditLog.create({data:{businessId:claim.businessId,userId:'sync-worker',action:'integration.sync',reason:claim.provider,result:code}});});},
  async completeCatalog(claim,result:CatalogResult){await db.$transaction(async tx=>{await fence(tx,claim);
    for(const p of result.products)await tx.product.upsert({where:{integrationId_externalId:{integrationId:claim.integrationId,externalId:p.externalId}},create:{businessId:claim.businessId,integrationId:claim.integrationId,externalId:p.externalId,name:p.name,sku:p.sku??null,currency:result.currency,price:p.price,salePrice:p.salePrice??null,inventoryQuantity:p.inventoryQuantity??null,status:p.status},update:{name:p.name,sku:p.sku??null,currency:result.currency,price:p.price,salePrice:p.salePrice??null,inventoryQuantity:p.inventoryQuantity??null,status:p.status,lastSeenAt:new Date()}});
    for(const c of result.customers)await tx.customer.upsert({where:{integrationId_externalId:{integrationId:claim.integrationId,externalId:c.externalId}},create:{businessId:claim.businessId,integrationId:claim.integrationId,externalId:c.externalId,name:c.name,email:c.email??null,phone:c.phone??null,currency:result.currency,totalOrders:c.totalOrders??0,totalSpent:c.totalSpent??0},update:{name:c.name,email:c.email??null,phone:c.phone??null,currency:result.currency,totalOrders:c.totalOrders??0,totalSpent:c.totalSpent??0,lastSeenAt:new Date()}});
    await tx.auditLog.create({data:{businessId:claim.businessId,userId:'sync-worker',action:'integration.catalog_sync',reason:claim.provider,result:`${result.products.length} products, ${result.customers.length} customers`}});
  });},
  async catalogFailed(claim,code){await db.auditLog.create({data:{businessId:claim.businessId,userId:'sync-worker',action:'integration.catalog_sync',reason:claim.provider,result:'failed:'+code}});},
};
export async function sourceSummaries(businessId:string,tenant:TenantContext):Promise<SourceSummary[]>{
  await requireBusiness(businessId,tenant);const integrations=await db.integration.findMany({where:{businessId,status:'connected'}});
  const summaries=await Promise.all(integrations.map(async i=>{const run=await db.syncRun.findFirst({where:{integrationId:i.id,version:i.version,status:'completed'},orderBy:{finishedAt:'desc'}});if(!run)return[];
    const metrics=await db.sourceMetric.findMany({where:{integrationId:i.id,version:i.version,date:{gte:run.from,lte:run.to}},orderBy:{date:'asc'}});
    return summarizeSource(i.provider,{rows:metrics.map(m=>sourceMetricSchema.parse(m.values)),records:metrics.length,notes:[...new Set(metrics.flatMap(m=>Array.isArray(m.notes)?m.notes.filter((n):n is string=>typeof n==='string'):[]))],timezone:metrics[0]?.timezone??'unknown'},i.lastSync?.toISOString()??'');
  }));return summaries.flat();
}
export async function integrationList(businessId:string,tenant:TenantContext){await requireBusiness(businessId,tenant);const rows=await db.integration.findMany({where:{businessId},select:{id:true,provider:true,status:true,accountId:true,lastSync:true,lastError:true,autoSync:true,version:true,syncRuns:{orderBy:{createdAt:'desc'},take:5,select:{id:true,status:true,records:true,errorCode:true,createdAt:true,finishedAt:true,from:true,to:true}}}});return rows;}
export async function listProducts(businessId:string,tenant:TenantContext){await requireBusiness(businessId,tenant);return db.product.findMany({where:{businessId},orderBy:{updatedAt:'desc'},take:500});}
// Only aggregates leave this function: no customer name/email/phone reaches callers (kept out of AI context per privacy rules).
export async function customerSummary(businessId:string,tenant:TenantContext){await requireBusiness(businessId,tenant);
  const rows=await db.customer.findMany({where:{businessId},select:{totalOrders:true,totalSpent:true}});
  const totalCustomers=rows.length,statsAvailable=rows.some(r=>r.totalOrders>0),returningCustomers=rows.filter(r=>r.totalOrders>1).length;
  return {totalCustomers,statsAvailable,returningCustomers,newCustomers:totalCustomers-returningCustomers,totalSpent:rows.reduce((sum,r)=>sum+Number(r.totalSpent),0)};
}
