// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddedSongBank} from './vgm.js';
import {playableSamples} from './sample-view.js';

function song(size,blocks){
  const header=Buffer.alloc(0x100);
  header.write('Vgm ');header.writeUInt32LE(0x171,8);header.writeUInt32LE(0xcc,0x34);
  header.writeUInt32LE(0x80000000+1000000,0x98);
  const chunks=[header];
  for(const [offset,data] of blocks){
    const block=Buffer.alloc(15);
    block.set([0x67,0x66,0x8b]);block.writeUInt32LE(8+data.length,3);
    block.writeUInt32LE(size,7);block.writeUInt32LE(offset,11);
    chunks.push(block,Buffer.from(data));
  }
  chunks.push(Buffer.from([0x62,0x66]));
  const bytes=Buffer.concat(chunks);bytes.writeUInt32LE(bytes.length-4,4);return bytes;
}

test('VGM banks preserve complete images and omit phrases with missing bytes',()=>{
  const table=[0,4,0,0,4,3,0,0,0,4,4,0,4,7];
  const blocks=[[0,table],[0x400,[1,2,3,4,5]]];
  const partial=embeddedSongBank(song(0x408,blocks));
  assert.deepEqual(playableSamples(partial),[0]);
  assert.deepEqual([...partial.slice(0x400,0x404)],[1,2,3,4]);
  assert.equal(embeddedSongBank(song(0x408,[blocks[0]])),null);
  assert.equal(embeddedSongBank(song(0x80000,blocks)),null);
  assert.equal(embeddedSongBank(song(0x408,[])),null);
  const image=new Uint8Array(0x408);image.set(table);image.fill(11,0x400);
  assert.deepEqual(embeddedSongBank(song(image.length,[[0,image]])),image);
});
