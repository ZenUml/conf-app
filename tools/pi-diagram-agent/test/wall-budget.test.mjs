// Per-diagram wall-clock budget: default 15 minutes, PI_DIAGRAM_MAX_WALL_MIN overrides it, both gates share it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUDGETS,defaultBudgetsFor,budgetsFromEnv} from '../src/orchestrator.mjs';

test('default wall clock is 15 minutes (900000 ms) for every gate',()=>{
  assert.equal(DEFAULT_BUDGETS.maxWallMs,900_000);
  assert.equal(defaultBudgetsFor('strict').maxWallMs,900_000);
  assert.equal(defaultBudgetsFor('relaxed').maxWallMs,900_000);
  assert.equal(budgetsFromEnv({}).maxWallMs,900_000);
});

test('PI_DIAGRAM_MAX_WALL_MIN overrides the default; junk values keep it',()=>{
  assert.equal(budgetsFromEnv({PI_DIAGRAM_MAX_WALL_MIN:'25'}).maxWallMs,1_500_000);
  assert.equal(budgetsFromEnv({PI_DIAGRAM_MAX_WALL_MIN:'5'}).maxWallMs,300_000);
  for(const bad of ['0','-3','abc'])assert.equal(budgetsFromEnv({PI_DIAGRAM_MAX_WALL_MIN:bad}).maxWallMs,900_000,bad);
});
