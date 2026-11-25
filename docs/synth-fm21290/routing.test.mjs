import test from 'node:test';
import assert from 'node:assert/strict';
import {routing,routingExpression} from './routing.js';
import {dx7CarrierOperators} from '../playground/playground_dx7_voice_panel.js';

test('all 32 diagrams agree with Playground carrier numbering and expose one return',()=>{
  for(let algorithm=0;algorithm<32;algorithm++){
    const {edges,carriers,returnFrom,returnTo}=routing(algorithm);
    assert.deepEqual([...carriers].reverse(),dx7CarrierOperators(algorithm));
    assert.ok(returnFrom>=1 && returnTo<=6 && returnFrom<=returnTo);
    assert.equal(returnFrom!==returnTo,[3,5].includes(algorithm));
    for(let op=1;op<=6;op++)
      assert.ok(carriers.includes(op)||edges.some(([from,to])=>from===op && to<from));
  }
});
test('stacked, summed, branched and parallel diagrams preserve signal direction',()=>{
  for(const [algorithm,edges,feedback] of [
    [4,[[6,5],[5,4],[3,2],[2,1]],[4,6]],
    [6,[[6,5],[4,3],[2,1]],[5,6]],
    [16,[[6,5],[4,3],[5,1],[3,1],[2,1]],[6,6]],
    [21,[[6,5],[6,4],[3,2],[3,1]],[3,3]],
    [32,[],[6,6]],
  ]){
    const actual=routing(algorithm-1);
    assert.deepEqual(actual.edges,edges);
    assert.deepEqual([actual.returnFrom,actual.returnTo],feedback);
  }
});

test('routing text distinguishes summed inputs from parallel outputs',()=>{
  assert.equal(routingExpression(routing(31)),'OP1 + OP2 + OP3 + OP4 + OP5 + OP6');
  assert.equal(routingExpression(routing(3)),'(OP3 → OP2 → OP1) + (OP6 → OP5 → OP4)');
  for(let algorithm=0;algorithm<32;algorithm++){
    const text=routingExpression(routing(algorithm));
    assert.equal(new Set(text.match(/OP[1-6]/g)).size,6);
  }
});
