import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,transferVirtualFiles} from './playground_virtual_files.js';
import {createExplorerClipboard} from './playground_file_menu.js';

test('copy captures text and binary data, preserves empty folders, and never overwrites collisions',()=>{
  const fs=createVirtualFileSystem([{path:'/lib/a.js',data:'saved'},{path:'/lib/a.bin',data:new Uint8Array([0,255])}]);
  fs.mkdir('/lib/empty');const clipboard=createExplorerClipboard(fs);
  clipboard.capture('/lib');fs.writeText('/lib/a.js','later');
  assert.equal(clipboard.paste('/'),'/lib-copy');
  assert.equal(fs.get('/lib-copy/a.js').data,'saved');
  assert.deepEqual(fs.get('/lib-copy/a.bin').data,new Uint8Array([0,255]));
  assert.equal(fs.stat('/lib-copy/empty').type,'directory');
  assert.equal(clipboard.paste('/'),'/lib-copy-2');
  assert.equal(fs.get('/lib/a.js').data,'later');
  clipboard.clear();assert(!clipboard.available);assert.throws(()=>clipboard.paste('/'),/first/);
});

test('cut retains source and clipboard until the move succeeds',()=>{
  const fs=createVirtualFileSystem([{path:'/a.js',data:'a'}]);fs.mkdir('/lib');
  const clipboard=createExplorerClipboard(fs);clipboard.capture('/a.js',true);
  assert(fs.has('/a.js'));
  assert.equal(clipboard.paste('/lib',()=>false),null);assert(clipboard.available);
  assert.equal(clipboard.paste('/lib',(from,to)=>{transferVirtualFiles(fs,from,to);return true;}),'/lib/a.js');
  assert(!fs.has('/a.js'));assert(!clipboard.available);
});

test('invalid cut and paste paths cannot mutate files',()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'entry'},{path:'/a.js',data:'a'},{path:'/lib/a.js',data:'existing'}]);
  fs.mkdir('/sys');const clipboard=createExplorerClipboard(fs);
  assert.throws(()=>clipboard.capture('/index.js',true),/cannot be moved/);
  assert.throws(()=>clipboard.capture('/'),/cannot be copied/);
  clipboard.capture('/a.js',true);const before=fs.snapshot();
  assert.throws(()=>clipboard.paste('/lib'),/already exists/);
  assert.throws(()=>clipboard.paste('/sys'),/reserved/);
  assert.deepEqual(fs.snapshot(),before);assert(clipboard.available);
});
