import test from 'node:test';
import assert from 'node:assert/strict';
import {auditGateReasons,evaluateGate} from '../src/gate.mjs';

const H='a'.repeat(64),H2='b'.repeat(64);
const cleanAudit=()=>({status:'NOT-CHECKABLE',checks:{nodeIdentity:{status:'PASS'},semanticPreservation:{status:'PASS'},routeGeometry:{status:'NOT-CHECKABLE'},visualQuality:{status:'NOT-CHECKABLE'}}});
const ok=(over={})=>({reviewedHash:H,finalHash:H,renderedHash:H,audit:cleanAudit(),forbidden:[],review:{ok:true,verdict:'accept'},openBlocking:0,...over});
const codes=r=>r.reasons.map(x=>x.code);

test('gate passes only when every deterministic condition holds',()=>{
  const r=evaluateGate(ok());assert.equal(r.pass,true);assert.deepEqual(r.reasons,[]);
});

test('gate: hash identity — reviewed, final and orchestrator-rendered hashes must all be equal and present',()=>{
  assert.deepEqual(codes(evaluateGate(ok({finalHash:H2}))),['HASH_MISMATCH']);
  assert.deepEqual(codes(evaluateGate(ok({renderedHash:H2}))),['HASH_MISMATCH']);
  assert.deepEqual(codes(evaluateGate(ok({reviewedHash:H2}))),['HASH_MISMATCH']);
  assert.deepEqual(codes(evaluateGate(ok({reviewedHash:null}))),['HASH_MISMATCH']);
});

test('gate: any audit FAIL blocks; semantics must be PASS or ADJUDICATED',()=>{
  const failing=cleanAudit();failing.checks.textFit={status:'FAIL'};
  assert.ok(codes(evaluateGate(ok({audit:failing}))).includes('AUDIT_FAIL'));
  const adj=cleanAudit();adj.checks.semanticPreservation={status:'ADJUDICATED'};
  assert.equal(evaluateGate(ok({audit:adj})).pass,true);
  const nc=cleanAudit();nc.checks.semanticPreservation={status:'NOT-CHECKABLE'};
  assert.deepEqual(codes(evaluateGate(ok({audit:nc}))),['SEMANTICS_NOT_ESTABLISHED']);
  assert.deepEqual(codes(evaluateGate(ok({audit:null}))),['AUDIT_MISSING']);
});

test('gate: forbidden constructs, reviewer error or missing review, open blocking findings each block',()=>{
  assert.deepEqual(codes(evaluateGate(ok({forbidden:[{construct:'context-stroke',count:1}]}))),['FORBIDDEN_CONSTRUCT']);
  assert.deepEqual(codes(evaluateGate(ok({review:null}))),['REVIEW_MISSING']);
  assert.deepEqual(codes(evaluateGate(ok({review:{ok:false,error:'x'}}))),['REVIEW_MISSING']);
  assert.deepEqual(codes(evaluateGate(ok({openBlocking:2}))),['OPEN_BLOCKING']);
});

test('auditGateReasons: the pre-reviewer part (audit FAIL excluded: those are findings)',()=>{
  assert.deepEqual(auditGateReasons({audit:cleanAudit(),forbidden:[]}),[]);
  const nc=cleanAudit();nc.checks.semanticPreservation={status:'NOT-CHECKABLE'};
  assert.deepEqual(auditGateReasons({audit:nc,forbidden:[]}).map(x=>x.code),['SEMANTICS_NOT_ESTABLISHED']);
});

// Found by the live smoke: the auditor leaves originalGroupParity (and so semanticPreservation) NOT-CHECKABLE for any source WITHOUT groups
// ("original rendered SVG was not supplied" is its default text). A group-less source has no membership semantics to compare, so the
// identity checks decide; a source with groups still needs PASS/ADJUDICATED.
const groupless=(over={})=>{const a=cleanAudit();a.checks.semanticPreservation={status:'NOT-CHECKABLE'};a.checks.originalGroupParity={status:'NOT-CHECKABLE'};
  for(const k of ['nodeIdentity','nodeText','relations','relationStyle'])a.checks[k]={status:'PASS'};Object.assign(a.checks,over);return a};
test('gate: a group-less source passes semantics when identity, text, relations and style all PASS (auditor cannot compare groups that do not exist)',()=>{
  assert.equal(evaluateGate(ok({audit:groupless(),sourceGroupCount:0})).pass,true);
  assert.deepEqual(auditGateReasons({audit:groupless(),forbidden:[],sourceGroupCount:0}),[]);
});
test('gate: the group-less allowance is narrow — groups present, unknown group count, or any identity check not PASS',()=>{
  assert.deepEqual(codes(evaluateGate(ok({audit:groupless(),sourceGroupCount:2}))),['SEMANTICS_NOT_ESTABLISHED']);
  assert.deepEqual(codes(evaluateGate(ok({audit:groupless()}))),['SEMANTICS_NOT_ESTABLISHED']);
  for(const k of ['nodeIdentity','nodeText','relations','relationStyle'])
    assert.deepEqual(codes(evaluateGate(ok({audit:groupless({[k]:{status:'NOT-CHECKABLE'}}),sourceGroupCount:0}))),['SEMANTICS_NOT_ESTABLISHED'],k);
});
