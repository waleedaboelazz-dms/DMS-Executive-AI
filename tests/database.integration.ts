import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { metricsRepository, reportRepository } from '../src/adapters/prisma';
import { aiLimit } from '../src/lib/auth';

async function main() {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:55439/dms_test')) throw new Error('Only the isolated verification database is allowed');
  const suffix=randomUUID(), userId=`test-${suffix}`;
  const first=await db.organization.create({data:{name:'Verification A'}});
  const second=await db.organization.create({data:{name:'Verification B'}});
  try {
    const a=await db.business.create({data:{name:'A',organizationId:first.id}});
    const b=await db.business.create({data:{name:'B',organizationId:second.id}});
    const tenant={userId,organizationId:first.id,role:'owner'};
    const metric={date:'2026-09-06',revenue:1000.25,adSpend:200,cogs:300,expenses:100,orders:10,leads:4,sessions:200};
    await metricsRepository.save(a.id,tenant,metric);
    await metricsRepository.save(a.id,tenant,{...metric,revenue:1200.25});
    const list=await metricsRepository.list(a.id,tenant);
    assert.equal(list.length,1);assert.equal(list[0].revenue,1200.25);
    await assert.rejects(()=>metricsRepository.list(b.id,tenant),/Business not found/);
    await assert.rejects(()=>metricsRepository.save(b.id,tenant,metric),/Business not found/);
    await assert.rejects(()=>metricsRepository.save(a.id,{...tenant,role:'viewer'},metric),/Read-only/);
    const report=await reportRepository.save({businessId:a.id,tenant,title:'test',content:'verified',kind:'deterministic',context:{revenue:1200.25}});
    assert.ok(report.id);assert.equal(await db.auditLog.count({where:{businessId:a.id}}),3);
    await assert.rejects(()=>reportRepository.save({businessId:b.id,tenant,title:'test',content:'no',kind:'deterministic',context:{}}),/Business not found/);
    const calls=await Promise.allSettled(Array.from({length:11},()=>aiLimit(tenant)));
    assert.equal(calls.filter(r=>r.status==='fulfilled').length,10);
    assert.equal(calls.filter(r=>r.status==='rejected').length,1);
    console.log('PASS: PostgreSQL upsert, decimal persistence, tenant isolation, viewer denial, atomic audit, reports, concurrent rate limit.');
  } finally {
    await db.organization.deleteMany({where:{id:{in:[first.id,second.id]}}});
    await db.rateLimit.deleteMany({where:{key:{startsWith:`ai:${userId}:`}}});
    await db.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
