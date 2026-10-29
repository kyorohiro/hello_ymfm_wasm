import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHostAudio,encodeHostPcm,decodeHostPcm,MAX_HOST_FRAMES} from './spu_synth_long_audio.js';
import {writeSpuInstrument,readSpuInstrument} from './spu_synth_instrument.js';

test('software recordings retain signed mono PCM across base64 chunk boundaries',()=>{
  const pcm=Int16Array.from({length:1234567},(_,i)=>(i%65536)-32768);
  assert.deepEqual(decodeHostPcm(encodeHostPcm(pcm)),pcm);
  for(const invalid of ['', 'AA==','!!!!','AAAA=AAA','AAAA====']) assert.throws(()=>decodeHostPcm(invalid));
  assert.throws(()=>prepareHostAudio({sampleRate:44100,length:MAX_HOST_FRAMES+1,numberOfChannels:2}));
  const stereo={sampleRate:44100,length:3,numberOfChannels:2,getChannelData:ch=>ch?[1,-1,.5]:[-1,-1,.5]};
  assert.deepEqual(prepareHostAudio(stereo),Int16Array.from([0,-32768,16384]));
});

test('version 2 presets preserve long recordings, tuning, loops and settings',()=>{
  const pcm=Int16Array.from({length:44100*24},(_,i)=>i%32768);
  const source={sample:{pcm,baseFrequencyHz:440,loop:true},preset:{sample:24,volumeLeft:.75,volumeRight:-.5,adsr1:15,adsr2:0,pitch:4096,reverb:true},reverb:{preset:'room',volumeLeft:.3,volumeRight:.4}};
  const file=writeSpuInstrument('Long audio',source);
  assert.equal(file.version,2);
  const restored=readSpuInstrument(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(restored.sample.pcm,pcm);
  assert.equal(restored.sample.baseFrequencyHz,440);
  assert.equal(restored.sample.loop,true);
  assert.equal(restored.preset.volumeRight,-.5);
  assert.throws(()=>readSpuInstrument({...file,sample:{...file.sample,loop:'yes'}}));
  assert.throws(()=>readSpuInstrument({...file,sample:{...file.sample,baseFrequencyHz:0}}));
  assert.throws(()=>readSpuInstrument({...file,waveform:Array(112).fill(0)}));
});
