import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,resolvePath,normalizeVirtualPath,transferVirtualFiles} from '../src/index.js';

test('directory and file-relative paths have different bases and cannot escape root',()=>{
  assert.equal(resolvePath('notes.js','/lib'),'/lib/notes.js');
  assert.equal(normalizeVirtualPath('notes.js','/lib/main.js'),'/lib/notes.js');
  assert.equal(resolvePath('.','/a/../lib'),'/lib');
  assert.throws(()=>resolvePath('../../bad','/lib'),/escapes/);
  assert.equal(resolvePath('/'),'/');
});
test('empty directories, binary copies and snapshots preserve a complete project',()=>{
  const fs=createVirtualFileSystem();fs.mkdir('/empty');fs.mkdir('/deep/empty',{recursive:true});
  const bytes=new Uint8Array([0,255]);fs.writeBinary('/sound.bin',bytes);bytes[0]=99;
  const read=fs.get('/sound.bin');read.data[0]=88;
  assert.deepEqual(fs.get('/sound.bin').data,new Uint8Array([0,255]));
  const restored=createVirtualFileSystem();restored.restore(structuredClone(fs.snapshot()));
  assert.deepEqual(restored.snapshot(),fs.snapshot());
  assert.deepEqual(restored.readdir('/'),['deep','empty','sound.bin']);
  assert.throws(()=>restored.writeText('/empty','oops'));
});
test('failed replacement and transfers are atomic; successful transfer notifies once',()=>{
  const fs=createVirtualFileSystem([{path:'/src/a.js',data:'a'},{path:'/index.js',data:'entry'}]);fs.mkdir('/src/empty');
  const before=fs.snapshot();let changes=0;fs.onDidChange(()=>changes++);
  assert.throws(()=>fs.replace([{path:'/a',data:'file'},{path:'/a/child',data:'conflict'}]));
  assert.deepEqual(fs.snapshot(),before);assert.equal(changes,0);
  assert.throws(()=>transferVirtualFiles(fs,'/src','/index.js/child'));
  assert.deepEqual(fs.snapshot(),before);
  transferVirtualFiles(fs,'/src','/dst');assert.equal(changes,1);
  assert.equal(fs.stat('/dst/empty').type,'directory');assert.equal(fs.has('/src/a.js'),false);
  transferVirtualFiles(fs,'/index.js','/entry.js');assert.equal(fs.has('/entry.js'),true);
});
