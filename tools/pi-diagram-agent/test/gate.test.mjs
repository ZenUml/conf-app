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
