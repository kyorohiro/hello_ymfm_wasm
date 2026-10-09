import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,parseCommand} from '../js/tetorica_virtual_files/index.js';
import {completeShellPath} from './playground_shell.js';

const fs=createVirtualFileSystem([
  {path:'/index.js',data:''},
  {path:'/scripts/hello world.js',data:''},
  {path:'/scripts/heavy.js',data:''},
  {path:'/scripts/quote".js',data:''},
]);
test('completion resolves cwd, parent paths and directory prefixes',()=>{
  assert.equal(completeShellPath(fs,'/','cat /ind').source,'cat /index.js ');
  assert.equal(completeShellPath(fs,'/','cd /scr').source,'cd /scripts/');
  assert.equal(completeShellPath(fs,'/scripts','cat ../ind').source,'cat ../index.js ');
});
test('ambiguous paths list candidates without executing anything',()=>{
  const result=completeShellPath(fs,'/scripts','cat he');
  assert.equal(result.source,'cat he');assert.deepEqual(result.matches,['heavy.js','hello world.js']);
  assert.equal(completeShellPath(fs,'/','cat /missing/').source,'cat /missing/');
  assert.equal(completeShellPath(fs,'/','cat x; rm /').source,'cat x; rm /');
});
test('spaces, quotes and unfinished quoted paths round-trip through the shell parser',()=>{
  for(const prefix of ['cat "hello w','cat hello\\ w',"cat 'hello w"]){
    assert.deepEqual(parseCommand(completeShellPath(fs,'/scripts',prefix).source),['cat','hello world.js']);
  }
  assert.deepEqual(parseCommand(completeShellPath(fs,'/scripts','cat quo').source),['cat','quote".js']);
});
