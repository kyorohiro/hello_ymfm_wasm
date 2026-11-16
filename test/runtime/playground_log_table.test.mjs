import test from 'node:test';
import assert from 'node:assert/strict';
import {formatLogTable} from '../../tetorica_src/runtime/playground_log.js';

test('register traces produce an ordered readable table without mutating results',()=>{
  const rows=Object.freeze([Object.freeze({offsetSeconds:0,register:13,value:8}),Object.freeze({offsetSeconds:0.1,register:13,value:8})]);
  const table=formatLogTable(rows);
  assert.match(table,/offsetSeconds\s+\| register \| value/);
  assert.equal(table.split('\n').length,3);
  assert.equal((table.match(/13/g)??[]).length,2);
  assert.match(formatLogTable(rows,['value']),/value/);
  assert.doesNotMatch(formatLogTable(rows,['value']),/register/);
});
test('large tables bound display work and report omissions while preserving all source rows',()=>{
  const rows=Array.from({length:250},(_,register)=>({register,value:8}));
  assert.match(formatLogTable(rows),/50 more rows/);assert.equal(rows.length,250);
  assert.equal(formatLogTable([]),'(empty table)');assert.equal(formatLogTable('value'),'value');
  assert.throws(()=>formatLogTable(rows,[13]),/columns/);
});
