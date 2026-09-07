import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { Worker,UnrecoverableError } from 'bullmq';
import { db } from '@/lib/db';
import { getSyncQueue,redisConnection,syncQueue } from '@/adapters/integrations/queue';
import { integrationService } from '@/adapters/integrations/runtime';
import { providerSchema,ConnectorError } from '@/modules/integrations/types';
import { evaluateScheduledOperations } from '@/adapters/operations/prisma-store';
async function recoverAndSchedule(){
  const expired=await db.integration.findMany({where:{syncLeaseUntil:{lt:new Date()}},take:100});
  for(const integration of expired)await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM integrations WHERE id=${integration.id} FOR UPDATE`;const current=await tx.integration.findUniqueOrThrow({where:{id:integration.id}});if(!current.syncLeaseUntil||current.syncLeaseUntil>new Date())return;
    await tx.syncRun.updateMany({where:{integrationId:current.id,status:'running',attempts:{lt:3}},data:{status:'queued',errorCode:'WORKER_INTERRUPTED'}});
    await tx.syncRun.updateMany({where:{integrationId:current.id,status:'running',attempts:{gte:3}},data:{status:'failed',errorCode:'WORKER_INTERRUPTED',finishedAt:new Date()}});
    await tx.integration.update({where:{id:current.id},data:{syncOwner:null,syncLeaseUntil:null,lastError:'WORKER_INTERRUPTED'}});
  });
  // Outbox recovery: a DB commit followed by a Redis outage must not lose a sync request.
  const queued=await db.syncRun.findMany({where:{status:'queued'},take:100,orderBy:{createdAt:'asc'}});
  for(const run of queued)await syncQueue.enqueue(run.id);
  const due=await db.integration.findMany({where:{status:'connected',autoSync:true,OR:[{lastSync:null},{lastSync:{lt:new Date(Date.now()-60*60000)}}]},include:{business:{include:{organization:{include:{memberships:{where:{role:{in:['owner','admin']}},take:1}}}}}},take:100});
  for(const item of due){const member=item.business.organization.memberships[0];if(!member)continue;const to=new Date().toISOString().slice(0,10),from=new Date(Date.now()-29*86400000).toISOString().slice(0,10);await integrationService.sync(item.businessId,{userId:member.userId,organizationId:member.organizationId,role:member.role},providerSchema.parse(item.provider),{from,to});}
  await db.rateLimit.deleteMany({where:{expiresAt:{lt:new Date()}}});await db.oAuthAttempt.deleteMany({where:{expiresAt:{lt:new Date()}}});

}
async function main(){const queue=getSyncQueue();await queue.upsertJobScheduler('integration-recovery',{every:60000},{name:'recover',data:{},opts:{removeOnComplete:20,removeOnFail:50}});
  await queue.upsertJobScheduler('operations-evaluation',{every:60000},{name:'operations',data:{},opts:{removeOnComplete:20,removeOnFail:50}});
  const worker=new Worker('dms-integrations',async job=>{try{if(job.name==='operations')await evaluateScheduledOperations();else if(job.name==='recover')await recoverAndSchedule();else await integrationService.execute(String(job.data.runId));}catch(e){if(e instanceof ConnectorError&&!e.retryable)throw new UnrecoverableError(e.code);throw e;}},{connection:{...redisConnection(),maxRetriesPerRequest:null,enableOfflineQueue:true},concurrency:3});
  worker.on('failed',job=>console.error(JSON.stringify({event:'sync_job_failed',jobId:job?.id})));worker.on('error',()=>console.error(JSON.stringify({event:'sync_worker_error'})));
  const shutdown=async()=>{await worker.close();await queue.close();await db.$disconnect();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  console.log(JSON.stringify({event:'sync_worker_ready'}));
}
main().catch(()=>{console.error(JSON.stringify({event:'sync_worker_start_failed'}));process.exitCode=1;});
