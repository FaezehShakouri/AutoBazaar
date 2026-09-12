import test from 'node:test';
import assert from 'node:assert/strict';
import {DayPlayback} from '../dist/playback.js';
import {createGame,registerAgent,startRound,stepDemo} from '../dist/engine.js';

function dayWithSales(){let state=createGame();for(const a of state.agents)state=registerAgent(state,a.id);state=startRound(state);do{state=stepDemo(state);}while(!state.customerTransactions.length);return state;}
test('render frame sizes preserve the same receipts in order and replay never mutates market cash',()=>{
  const state=dayWithSales(),original=structuredClone(state),receipts=state.customerTransactions;
  for(const dt of [1/60,1/12,3,1000]){
    const playback=new DayPlayback();playback.load(receipts);const emitted=[];
    while(playback.active)emitted.push(...playback.advance(dt));
    assert.deepEqual(emitted,receipts);assert.equal(playback.cursor,receipts.length);assert.equal(playback.progress,1);
    assert.deepEqual(playback.advance(100),[]);
    playback.load(receipts);assert.deepEqual(playback.advance(playback.duration),receipts);
  }
  assert.deepEqual(state,original);
});
test('pause, empty days, reset and skip cannot lose or duplicate a receipt',()=>{
  const p=new DayPlayback();p.load([{payment:100},{payment:50}]);
  assert.deepEqual(p.advance(0),[]);assert.equal(p.time,0);
  assert.deepEqual(p.advance(4),[{payment:100}]);assert.deepEqual(p.advance(0),[]);
  assert.deepEqual(p.advance(100),[{payment:50}]);assert.equal(p.active,false);
  p.load([]);assert.equal(p.active,true);assert.deepEqual(p.advance(5),[]);assert.equal(p.active,false);
  p.load([{payment:2}]);p.reset();assert.equal(p.cursor,0);assert.equal(p.active,false);assert.deepEqual(p.advance(100),[]);
});
