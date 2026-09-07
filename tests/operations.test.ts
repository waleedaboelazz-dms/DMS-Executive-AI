import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedDay,evaluateCondition,OperationsService,operationInput } from '../src/modules/operations/service';
import { emptyOperations,applyDemoOperation } from '../src/modules/operations/demo';
const row={date:'2026-09-05',revenue:100,adSpend:100,cogs:10,expenses:0,orders:2,leads:0,sessions:100};
const condition={metric:'roas' as const,operator:'lt' as const,threshold:1.5,days:2};
test('automation requires every consecutive day and ignores incomplete or duplicate records',()=>{
  assert.equal(evaluateCondition(condition,[row],'2026-09-05').matched,false);
  const rows=[{...row,date:'2026-09-04'},row];assert.equal(evaluateCondition(condition,rows,'2026-09-05').matched,true);
  assert.equal(evaluateCondition(condition,[...rows,row],'2026-09-05').matched,false);
  assert.equal(evaluateCondition(condition,[{...row,date:'2026-09-04',revenue:400},row],'2026-09-05').matched,false);
  assert.equal(evaluateCondition({...condition,days:1},[{...row,adSpend:0}],'2026-09-05').complete,false);
});
test('automation windows use previous completed business day including timezone boundaries',()=>{
  assert.equal(completedDay('Asia/Riyadh',new Date('2026-09-06T22:00:00Z')),'2026-09-06');
  assert.equal(completedDay('America/New_York',new Date('2026-09-06T01:00:00Z')),'2026-09-04');
});
test('reusable operations service blocks viewers and member approvals before invoking storage',async()=>{
  let calls=0;const service=new OperationsService({list:async()=>[],apply:async()=>{calls++;}});
  const tenant={userId:'u',organizationId:'o',role:'viewer'};
  assert.throws(()=>service.execute('b',tenant,{operation:'create_task',task:{title:'Review'}}),/Read-only/);
  assert.throws(()=>service.execute('b',{...tenant,role:'member'},{operation:'decide',id:'a',decision:'approve',reason:'Reviewed'}),/admin/);
  assert.equal(calls,0);
  await service.execute('b',{...tenant,role:'member'},{operation:'create_task',task:{title:'Review'}});assert.equal(calls,1);
});
test('only supported actions and bounded rule inputs are accepted',()=>{
  assert.equal(operationInput.safeParse({operation:'pause_campaign',id:'external'}).success,false);
  assert.equal(operationInput.safeParse({operation:'create_rule',rule:{name:'Invalid',condition:{...condition,days:0},action:'alert'}}).success,false);
});
test('demo uses actual rule evaluator and approval never creates a task before the decision',()=>{
  let state=applyDemoOperation(emptyOperations(),{operation:'create_rule',rule:{name:'Review spend',condition:{...condition,days:1},action:'task_approval'}},[row]);
  state=applyDemoOperation(state,{operation:'toggle_rule',id:state.rules[0].id,enabled:true},[row]);
  state=applyDemoOperation(state,{operation:'evaluate'},[row]);state=applyDemoOperation(state,{operation:'evaluate'},[row]);
  assert.equal(state.alerts.length,1);assert.equal(state.approvals.length,1);assert.equal(state.tasks.length,0);
  const command={operation:'decide' as const,id:state.approvals[0].id,decision:'approve' as const,reason:'Reviewed'};
  state=applyDemoOperation(state,command,[row]);assert.equal(state.tasks.length,1);
  assert.throws(()=>applyDemoOperation(state,command,[row]),/already decided/);
});
