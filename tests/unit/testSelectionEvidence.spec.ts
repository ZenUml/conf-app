import {describe,it,expect} from 'vitest';
import {aggregateEvidence,canReuse,createEvidence} from '../../scripts/test-selection/evidence.mjs';
const plan={schema_version:1,tested_tree:'tree',category_version:'v1',policy_version:'v1',variant:'lite',coverage:'selected',plan_fingerprint:'fingerprint',tests:[{id:'a'},{id:'b'}],shards:[{index:1,test_ids:['a']},{index:2,test_ids:['b']}]};
const report=(index:number,status='passed')=>({...createEvidence(plan,[{id:index===1?'a':'b',status}]),shard_index:index,run_status:'passed'});
describe('execution evidence versus reusable coverage',()=>{
 it('permits legitimate reported skips without claiming reusable complete success',()=>{const e=aggregateEvidence(plan,[report(1),report(2,'skipped')]);expect(e.validation.valid).toBe(true);expect(e.execution_succeeded).toBe(true);expect(e.complete).toBe(false);expect(canReuse(e,plan)).toBe(false);});
 it('complete passing shards qualify for reuse',()=>{const e=aggregateEvidence(plan,[report(1),report(2)]);expect(e.complete).toBe(true);expect(canReuse(e,plan)).toBe(true);});
 it('missing results or shards invalidate execution evidence',()=>{const e=aggregateEvidence(plan,[report(1)]);expect(e.validation.valid).toBe(false);expect(e.execution_succeeded).toBe(false);expect(e.validation.errors).toContain('missing-test-results');});
 it('actual failed tests and interrupted runs are unsuccessful',()=>{expect(aggregateEvidence(plan,[report(1),report(2,'failed')]).execution_succeeded).toBe(false);expect(aggregateEvidence(plan,[report(1),{...report(2),run_status:'interrupted'}]).execution_succeeded).toBe(false);});
 it('rejects different trees and duplicated shard evidence',()=>{expect(aggregateEvidence(plan,[report(1),{...report(2),tested_tree:'other'}]).validation.errors).toContain('mismatched-report-identity');expect(aggregateEvidence(plan,[report(1),report(1),report(2)]).validation.valid).toBe(false);});
 it('rejects shard identities reporting another shards tests',()=>{const e=aggregateEvidence(plan,[{...report(1),shard_index:2},{...report(2),shard_index:1}]);expect(e.validation.errors).toContain('invalid-shard-coverage');expect(e.complete).toBe(false);});
});
