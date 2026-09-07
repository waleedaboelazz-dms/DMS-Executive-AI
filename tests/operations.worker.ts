import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueueEvents } from 'bullmq';
import { db } from '../src/lib/db';
import { getSyncQueue,redisConnection } from '../src/adapters/integrations/queue';
import { completedDay } from '../src/modules/operations/service';
async function main(){
  if(!process.env.DATABASE_URL?.includes('127.0.0.1:55439/dms_test')||process.env.REDIS_URL!=='redis://127.0.0.1:56379')throw Error('Isolated infrastructure required');
  const userId=randomUUID(),org=await db.organization.create({data:{name:'Worker verification'}}),queue=getSyncQueue(),events=new QueueEvents('dms-integrations',{connection:{...redisConnection(),maxRetriesPerRequest:null}});
  try{
    await events.waitUntilReady();
    await db.user.create({data:{id:userId,memberships:{create:{organizationId:org.id,role:'owner'}}}});
    const business=await db.business.create({data:{organizationId:org.id,name:'Scheduled business',metrics:{create:{date:new Date(completedDay('Asia/Riyadh')),revenue:100,adSpend:100,cogs:0,expenses:0,orders:1,leads:0,sessions:10}},automationRules:{create:{name:'Scheduled low ROAS',enabled:true,condition:{metric:'roas',operator:'lt',threshold:2,days:1},action:{type:'task_approval'}}}}});
    const schedulers=await queue.getJobSchedulers();assert.ok(schedulers.some(s=>s.key==='operations-evaluation'));
    const job=await queue.add('operations',{}, {removeOnComplete:true,removeOnFail:true});await job.waitUntilFinished(events,30000);
    assert.equal(await db.alert.count({where:{businessId:business.id}}),1);assert.equal(await db.approval.count({where:{businessId:business.id,status:'pending'}}),1);assert.equal(await db.task.count({where:{businessId:business.id}}),0);
    console.log('PASS: production worker operations schedule registered; real BullMQ job evaluates PostgreSQL ledger, persists alert and pending approval without executing task.');
  }finally{await events.close();await queue.close();await db.organization.deleteMany({where:{id:org.id}});await db.user.deleteMany({where:{id:userId}});await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
