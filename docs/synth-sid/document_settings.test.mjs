import test from 'node:test';
import assert from 'node:assert/strict';
import {createChannelSettings,readChannelSettings} from './channel_settings.js';
import {applySidDocumentChanges} from './document_settings.js';

test('SID document acceptance preserves independent live CH fields and dormant shared filter values',()=>{
 const before=createChannelSettings(),live=structuredClone(before),next=structuredClone(before);
 live.target=2;live.channels[1].voice.waveform='pulse';live.channels[1].voice.pulseWidth=719;
 live.channels[2].voice.attack=13;live.channels[2].modulation.ratio=1.7;
 for(const voice of live.channels){voice.filter.cutoff=1100;voice.filter.resonance=9;}
 next.channels[0].voice.release=3;for(const voice of next.channels)voice.filter.volume=7;
 const input=structuredClone([before,live,next]),result=applySidDocumentChanges(live,before,next);
 assert.equal(result.target,2);assert.equal(result.channels[0].voice.release,3);
 assert.equal(result.channels[1].voice.waveform,'pulse');assert.equal(result.channels[1].voice.pulseWidth,719);
 assert.equal(result.channels[2].voice.attack,13);assert.equal(result.channels[2].modulation.ratio,1.7);
 for(const voice of result.channels){assert.equal(voice.filter.cutoff,1100);assert.equal(voice.filter.resonance,9);assert.equal(voice.filter.volume,7);}
 assert.deepEqual([before,live,next],input);
});
test('SID combined waveform changes merge only edited flags and model/filter remain shared',()=>{
 const before=createChannelSettings(),live=structuredClone(before),next=structuredClone(before);
 live.channels[1].voice.waveform='saw+pulse';next.channels[1].voice.waveform='saw+triangle';
 for(const voice of next.channels){voice.model='8580';voice.filter.mode='lowpass+bandpass';voice.filter.enabled=true;}
 const result=applySidDocumentChanges(live,before,next);
 assert.equal(result.channels[1].voice.waveform,'triangle+saw+pulse');
 for(const voice of result.channels){assert.equal(voice.model,'8580');assert.equal(voice.filter.mode,'lowpass+bandpass');}
 assert.deepEqual(readChannelSettings(result),result);
});
test('choosing round robin and editing one release do not homogenize stored voices',()=>{
 const before=createChannelSettings(),live=structuredClone(before);live.target=1;
 live.channels[0].voice.waveform='triangle';live.channels[1].voice.waveform='pulse';live.channels[2].voice.waveform='noise';
 const next=structuredClone(live);next.target='round-robin';
 assert.deepEqual(applySidDocumentChanges(live,live,next).channels,live.channels);
 const edit=structuredClone(next);for(const voice of edit.channels)voice.voice.release=11;
 const result=applySidDocumentChanges(live,next,edit);
 assert.deepEqual(result.channels.map(voice=>voice.voice.waveform),['triangle','pulse','noise']);
 assert(result.channels.every(voice=>voice.voice.release===11));
});
