import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMixPlan } from '../src/services/ai/mixPlan.ts';
const plan = {trackId:'b',enterAfterBeats:32,transitionBeats:16,adjustments:[{beat:0,control:'mid',value:40}]};
test('accepts bounded plans and rejects foreign IDs, unsafe controls and invalid times',()=>{
 assert.ok(validateMixPlan(plan,['b']));
 assert.equal(validateMixPlan(plan,['c']),null);
 assert.equal(validateMixPlan({...plan,adjustments:[{beat:0,control:'gain',value:45,deck:'C'}]},['b']),null);
 assert.ok(validateMixPlan({...plan,adjustments:[{beat:0,control:'gain',value:45,deck:'B'}]},['b']));
 for (const patch of [{enterAfterBeats:0},{transitionBeats:200},{adjustments:[{beat:0,control:'master',value:100}]},{adjustments:[{beat:0,control:'low',value:NaN}]},{adjustments:[{beat:0,control:'filter',value:90}]}]) assert.equal(validateMixPlan({...plan,...patch},['b']),null);
});
