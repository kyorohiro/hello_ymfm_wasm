import test from 'node:test';
import assert from 'node:assert/strict';
import {keyboardChannels,keyboardChannelHint} from './playground_keyboard_channels.js';

test('Keyboard channel catalog distinguishes OPN sections and physical voice counts',()=>{
  assert.equal(keyboardChannels('ym2612').length,6);
  assert.deepEqual(keyboardChannels('ym2203').map(channel=>channel.id),['fm:0','fm:1','fm:2','ssg:0','ssg:1','ssg:2']);
  assert.equal(keyboardChannels('ym2608').length,16);
  assert.equal(keyboardChannels('ym2610').filter(channel=>channel.id.startsWith('fm:')).length,4);
  for(const channels of [keyboardChannels('ym2610b'),keyboardChannels('ym2610',{model:'ym2610b'})]){
    assert.equal(channels.filter(channel=>channel.id.startsWith('fm:')).length,6);
    assert.equal(channels.filter(channel=>channel.id.startsWith('adpcm-a:')).length,6);
    assert.equal(channels.filter(channel=>channel.id.startsWith('adpcm-b:')).length,1);
  }
  const first=keyboardChannels('ym2612');first[0].label='changed';assert.equal(keyboardChannels('ym2612')[0].label,'FM 1');
});

test('native Keyboard adapters include noise/sample voices and one polyphonic DX7 target',()=>{
  const counts={scsp:32,ay8910:3,segapsg:4,gameboy:4,nes:6,snes:8,ym2151:8,huc6280:6,rf5c164:8,okim6258:1,dx7:1,ym3526:9,ym3812:9,ymf262:18,ym2413:9};
  for(const [kind,count]of Object.entries(counts)){
    const channels=keyboardChannels(kind);assert.equal(channels.length,count,kind);assert.equal(new Set(channels.map(channel=>channel.id)).size,count);assert(channels.every((channel,index)=>channel.id===String(index)&&channel.label.length>0));
  }
  assert.equal(keyboardChannels('nes',{fds:false}).length,5);
  assert.deepEqual(keyboardChannels('y8950').map(row=>row.id),['0','1','2','3','4','5','6','7','8','adpcm']);
  assert.deepEqual(keyboardChannels('y8950',{rhythmEnabled:true,rhythmVoices:true}).map(row=>row.id),['0','1','2','3','4','5','rhythm:0','rhythm:1','rhythm:2','rhythm:3','rhythm:4','adpcm']);
  assert.equal(keyboardChannels('nes',{fdsEnabled:false}).length,5);
  assert.match(keyboardChannels('dx7')[0].label,/16 voices/);
  for(const kind of ['pwm','unknown'])assert.deepEqual(keyboardChannels(kind),[]);
});

test('Keyboard hints describe actual sample/noise/stream pitch limitations',()=>{
  for(const [kind,ch]of [['segapsg','3'],['gameboy','3'],['nes','3']])assert.match(keyboardChannelHint(kind,ch),/noise/);
  for(const [kind,ch]of [['nes','4'],['okim6258','0'],['ym2608','rhythm:2'],['ym2610b','adpcm-b:0'],['y8950','adpcm']])assert.match(keyboardChannelHint(kind,ch),/current playback rate/);
  assert.match(keyboardChannelHint('rf5c164'),/C4/);
  assert.match(keyboardChannelHint('pwm'),/timed sample stream/);
  assert.match(keyboardChannelHint('unknown'),/keyboard.bind/);
});

 test('OPL3 Keyboard omits borrowed pair secondaries and rhythm-reserved voices',()=>{
  const registers=new Uint8Array(512);registers[0x104]=0b100001;registers[0xbd]=32;
  const ids=keyboardChannels('ymf262',{registers}).map(row=>row.id);
  for(const id of ['3','14','6','7','8'])assert(!ids.includes(id));
  for(const id of ['0','11','9','17'])assert(ids.includes(id));
});

test('YM2413 rhythm Keyboard keeps six melodic choices and exposes five hardware drum triggers',()=>{
 const registers=new Uint8Array(64);registers[0x0e]=32;const choices=keyboardChannels('ym2413',{registers});
 assert.deepEqual(choices.map(row=>row.id),['0','1','2','3','4','5','rhythm:0','rhythm:1','rhythm:2','rhythm:3','rhythm:4']);assert.match(keyboardChannelHint('ym2413','rhythm:4'),/does not retune/);
});

test('YM2413 Keyboard prefers applied layout metadata over a future authoring register shadow',()=>{
 const registers=new Uint8Array(64);registers[0x0e]=32;assert.equal(keyboardChannels('ym2413',{registers,rhythmEnabled:false}).length,9);registers[0x0e]=0;assert.equal(keyboardChannels('ym2413',{registers,rhythmEnabled:true}).length,11);
});
