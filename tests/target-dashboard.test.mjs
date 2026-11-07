import test from 'node:test';
import assert from 'node:assert/strict';
import '../performance/targets.js';
import {scopedTargets} from '../server/dms-login-worker.mjs';
const {parse,snapshot,summarize}=globalThis.DmsTargets;
test('validates and normalizes target Excel and sums Morning MTD rows',()=>{
 assert.deepEqual(parse([['DSO Wallet','Monthly Target'],['01332517801','1,000'],[846,500]]),{801:1000,846:500});
 assert.throws(()=>parse([['DSO','Target'],[801,100],[801,200]]),/duplicate/);
 assert.deepEqual(snapshot({rows:[[801,'150'],['01332517801','200'],[846,'25']]},{dso:0,mtdTxn:1}),{801:350,846:25});
});
test('uses cumulative snapshots once, ignores incomplete and future snapshots',()=>{
 const s=summarize({targets:{801:1000,802:1000},history:{'2026-11-02':{801:100,802:200},'2026-11-03':{801:300,802:400},'2026-11-04':{801:500},'2026-11-06':{801:1000,802:1000}}},'2026-11','2026-11-05');
 assert.equal(s.latest.amount,700);assert.equal(s.pct,35);assert.equal(s.left,26);assert.equal(s.daily,50);assert.equal(s.points.length,2);
});
test('scopes targets and history to DSO, DSS and management roles',()=>{
 const data={targets:{801:1000,802:2000},history:{'2026-11-01':{801:200,802:400}}};
 const assignments={a:{dso:'801',dss:'SOHAG'},b:{dso:'802',dss:'RUBEL'}};
 assert.deepEqual(scopedTargets('01332517802',data,assignments).targets,{802:2000});
 assert.deepEqual(scopedTargets('sohag',data,assignments).history['2026-11-01'],{801:200});
 assert.deepEqual(scopedTargets('zahangir',data,assignments).targets,data.targets);
});
test('finds the target sheet and headers after title rows and skips totals',()=>{
 assert.deepEqual(globalThis.DmsTargets.parseSheets([{rows:[['Cover']]},{rows:[['November'],[],['DSO Number','Target Amount'],[801,1500],['Grand Total',1500]]}]),{801:1500});
 assert.throws(()=>globalThis.DmsTargets.parseSheets([{rows:[['DSO','Target'],[801,1]]},{rows:[['DSO','Target'],[802,1]]}]),/একাধিক/);
});
test('sums phase amounts by DSO, prefers explicit monthly total, and rejects percentages',()=>{
 const parse=globalThis.DmsTargets.parse;
 assert.deepEqual(parse([['DSO','Phase 1 Target','Phase 2 Target','Phase 3 Target'],[801,320,340,320]]),{801:980});
 assert.deepEqual(parse([['DSO','Monthly Target','Phase 1 Target','Phase 2 Target'],[801,1000,320,340]]),{801:1000});
 assert.deepEqual(parse([['DSO','Phase','Target Amount'],[801,'Phase 1',320],[801,'Phase 2',340]]),{801:660});
 assert.throws(()=>parse([['DSO','Phase 1','Phase 2'],[801,'32%','34%']]),/Invalid/);
});
test('projects month-end amount and target percentage from report date',()=>{
 const s=globalThis.DmsTargets.summarize({targets:{801:1000},history:{'2026-11-10':{801:400}}},'2026-11','2026-11-12');
 assert.equal(s.trend,1200);assert.equal(s.trendPct,120);assert.equal(s.pct,40);
});
test('Morning Report uses previous completed day and corrects across month boundaries',()=>{
 assert.equal(DmsTargets.morningAsOf('2026-11-07'),'2026-11-06');
 assert.equal(DmsTargets.morningAsOf('2026-11-01'),'2026-10-31');
 assert.throws(()=>DmsTargets.morningAsOf('2026-11-31'));
 const patch=DmsTargets.historyUpdates('2026-11-07',{801:100},{ci:{801:60}},true);
 assert.equal(patch['dms_target_tracking/2026-11/history/2026-11-07'],null);
 assert.deepEqual(patch['dms_target_tracking/2026-11/history/2026-11-06'],{801:100});
 const summary=DmsTargets.summarize({targets:{801:130696735},history:{'2026-11-06':{801:23737207.64}}},'2026-11','2026-11-07');
 assert.equal(summary.trendPct.toFixed(2),'90.81');
});
