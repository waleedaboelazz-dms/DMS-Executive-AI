import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { operationsService } from '../src/adapters/operations/prisma-store';
import { completedDay,previousDay } from '../src/modules/operations/service';
async function main(){
  if(!process.env.DATABASE_URL?.includes('127.0.0.1:55439/dms_test'))throw Error('Only isolated test DB allowed');
  const userId=randomUUID(),org=await db.organization.create({data:{name:'Operations verification'}}),other=await db.organization.create({data:{name:'Other tenant'}});
  try{
    await db.user.create({data:{id:userId,memberships:{create:{organizationId:org.id,role:'owner'}}}});
    const business=await db.business.create({data:{name:'Test',organizationId:org.id}}),foreign=await db.business.create({data:{name:'Other',organizationId:other.id}});
    const tenant={userId,organizationId:org.id,role:'owner'},run=(command:unknown)=>operationsService.execute(business.id,tenant,command);
    await assert.rejects(()=>operationsService.execute(foreign.id,tenant,{operation:'create_task',task:{title:'Denied'}}),/not found/);
    await assert.rejects(()=>operationsService.list(foreign.id,tenant),/not found/);
    const request=await run({operation:'request_approval',task:{title:'Review campaign',priority:'high'},reason:'Evidence reviewed'}) as {id:string};
    assert.equal(await db.task.count({where:{businessId:business.id}}),0);
    const decisions=await Promise.allSettled([1,2].map(()=>run({operation:'decide',id:request.id,decision:'approve',reason:'Owner approved'})));
    assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.task.count({where:{businessId:business.id}}),1);
    const reject=await run({operation:'request_approval',task:{title:'Reject me'},reason:'Proposal'}) as {id:string};
    await run({operation:'decide',id:reject.id,decision:'reject',reason:'Not needed'});assert.equal(await db.task.count({where:{businessId:business.id}}),1);
    const tampered=await run({operation:'request_approval',task:{title:'Original'},reason:'Proposal'}) as {id:string};
    await db.approval.update({where:{id:tampered.id},data:{immutablePayload:{task:{title:'Changed',priority:'normal',dueDate:null},reason:'Proposal'}}});
    await assert.rejects(()=>run({operation:'decide',id:tampered.id,decision:'approve',reason:'Review'}),/integrity/);
    await db.membership.update({where:{userId_organizationId:{userId,organizationId:org.id}},data:{role:'viewer'}});
    await assert.rejects(()=>run({operation:'create_task',task:{title:'Stale owner context'}}),/Read-only/);
    await db.membership.update({where:{userId_organizationId:{userId,organizationId:org.id}},data:{role:'owner'}});
    const end=completedDay('Asia/Riyadh'),metric={businessId:business.id,revenue:100,adSpend:100,cogs:20,expenses:0,orders:2,leads:0,sessions:100};
    await db.metric.create({data:{...metric,date:new Date(end)}});
    const rule=await run({operation:'create_rule',rule:{name:'Low ROAS',condition:{metric:'roas',operator:'lt',threshold:1.5,days:2},action:'task_approval'}}) as {id:string};
    await run({operation:'toggle_rule',id:rule.id,enabled:true});await run({operation:'evaluate'});
    assert.equal(await db.alert.count({where:{businessId:business.id}}),0);
    await db.metric.create({data:{...metric,date:new Date(previousDay(end))}});
    await Promise.all([run({operation:'evaluate'}),run({operation:'evaluate'})]);
    assert.equal(await db.alert.count({where:{businessId:business.id}}),1);
    assert.equal(await db.approval.count({where:{businessId:business.id}}),4);
    const alert=await db.alert.findFirstOrThrow({where:{businessId:business.id}});
    await Promise.all([run({operation:'alert_task',id:alert.id}),run({operation:'alert_task',id:alert.id})]);
    assert.equal(await db.task.count({where:{businessId:business.id}}),2);
    await run({operation:'resolve_alert',id:alert.id});assert.ok((await db.alert.findUniqueOrThrow({where:{id:alert.id}})).resolvedAt);
    assert.equal(await db.auditLog.count({where:{businessId:business.id,action:'operations.approval_approve'}}),1);
    console.log('PASS: isolated PostgreSQL tenant/RBAC checks, revoked membership, payload integrity, concurrent approval exactly once, rejection, missing-day recovery, concurrent rule deduplication, alert task idempotency and audit.');
  }finally{await db.organization.deleteMany({where:{id:{in:[org.id,other.id]}}});await db.user.deleteMany({where:{id:userId}});await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
