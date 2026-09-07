import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { Worker,QueueEvents } from 'bullmq';
import { db } from '../src/lib/db';
import { integrationStore,integrationList,sourceSummaries } from '../src/adapters/integrations/prisma-store';
import { getSyncQueue,redisConnection,syncQueue } from '../src/adapters/integrations/queue';
import { IntegrationService } from '../src/modules/integrations/service';
import type { SyncResult } from '../src/modules/integrations/types';
import { oauthHash } from '../src/adapters/integrations/oauth';
async function main(){
  if(!process.env.DATABASE_URL?.includes('127.0.0.1:55439/dms_test')||!process.env.REDIS_URL?.includes('127.0.0.1:56379'))throw new Error('Only isolated test services are allowed');
  process.env.CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const org=await db.organization.create({data:{name:'Sync verification'}}),other=await db.organization.create({data:{name:'Other tenant'}});
  const business=await db.business.create({data:{name:'Store',organizationId:org.id}}),foreign=await db.business.create({data:{name:'Private',organizationId:other.id}});
  const tenant={userId:'test-user',organizationId:org.id,role:'owner'},credentials={accessToken:'never-leak-this-provider-secret'};
  let result:SyncResult={rows:[{date:'2026-09-01',currency:'SAR',grossSales:100,orders:1},{date:'2026-09-02',currency:'SAR',grossSales:200,orders:2}],records:3,timezone:'Asia/Riyadh',notes:['Test fixture, no live merchant calls']};
  const service=new IntegrationService(integrationStore,()=>({provider:'salla',testConnection:async()=>{},fetchMetrics:async()=>result}),syncQueue);
  const queue=getSyncQueue(),events=new QueueEvents('dms-integrations',{connection:{...redisConnection(),maxRetriesPerRequest:null,enableOfflineQueue:true}});
  const worker=new Worker('dms-integrations',async job=>service.execute(job.data.runId),{connection:{...redisConnection(),maxRetriesPerRequest:null,enableOfflineQueue:true}});
  await events.waitUntilReady();
  try{
    await assert.rejects(()=>service.connect(foreign.id,tenant,'salla',credentials),/Business not found/);
    await assert.rejects(()=>service.connect(business.id,{...tenant,role:'member'},'salla',credentials),/owner or admin/);
    await service.connect(business.id,tenant,'salla',credentials);
    const integration=await db.integration.findUniqueOrThrow({where:{businessId_provider:{businessId:business.id,provider:'salla'}},include:{credential:true}});
    assert.ok(!integration.credential!.encryptedValue.includes(credentials.accessToken));assert.ok(!JSON.stringify(await integrationList(business.id,tenant)).includes(credentials.accessToken));
    const first=await service.sync(business.id,tenant,'salla',{from:'2026-09-01',to:'2026-09-02'});await (await queue.getJob(first.id))!.waitUntilFinished(events,10000);
    assert.equal(await db.sourceMetric.count({where:{integrationId:integration.id}}),2);assert.equal((await sourceSummaries(business.id,tenant))[0].totals.grossSales,300);
    assert.equal(await integrationStore.claim(first.id),null);
    result={...result,rows:[{date:'2026-09-01',currency:'SAR',grossSales:150,orders:1}],records:1};
    const second=await service.sync(business.id,tenant,'salla',{from:'2026-09-01',to:'2026-09-02'});await (await queue.getJob(second.id))!.waitUntilFinished(events,10000);
    assert.equal(await db.sourceMetric.count({where:{integrationId:integration.id}}),1);assert.equal((await sourceSummaries(business.id,tenant))[0].totals.grossSales,150);
    // A worker that completes after disconnection must be fenced out.
    const third=await integrationStore.request(business.id,tenant,'salla',{from:'2026-09-01',to:'2026-09-02'}),claim=await integrationStore.claim(third);assert.ok(claim);
    await service.disconnect(business.id,tenant,'salla');await assert.rejects(()=>integrationStore.complete(claim!,result),/Connection changed/);
    assert.equal(await db.integrationCredential.count({where:{integrationId:integration.id}}),0);assert.equal((await sourceSummaries(business.id,tenant)).length,0);
    assert.equal((await db.syncRun.findUniqueOrThrow({where:{id:third}})).status,'cancelled');
    // OAuth state is one-use under competing callbacks.
    const stateHash=oauthHash(randomUUID());await db.oAuthAttempt.create({data:{stateHash,userId:tenant.userId,organizationId:org.id,businessId:business.id,provider:'salla',cookieHash:oauthHash('cookie'),expiresAt:new Date(Date.now()+60000)}});
    const claims=await Promise.all([1,2].map(()=>db.oAuthAttempt.updateMany({where:{stateHash,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}})));assert.equal(claims.reduce((sum,r)=>sum+r.count,0),1);
    await db.oAuthAttempt.delete({where:{stateHash}});
    console.log('PASS: real PostgreSQL + Redis queue, encrypted storage, tenant/admin isolation, atomic snapshots, no duplicate totals, removed records, disconnect fencing and single-use OAuth state.');
  }finally{await worker.close();await events.close();await queue.close();await db.organization.deleteMany({where:{id:{in:[org.id,other.id]}}});await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
