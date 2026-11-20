import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeSidSoundDocument} from './code_sound_document.js';
import {createDefaultPreset,readPreset} from './preset.js';
import {createChannelSettings,readChannelSettings} from './channel_settings.js';

test('linked portable voice retains its schema and writes only the chosen physical voice',()=>{
  const bank=createChannelSettings();bank.target=2;bank.channels[0].voice.waveform='pulse';bank.channels[2].voice.waveform='triangle+saw';
  const source=createDefaultPreset(),before=structuredClone(bank),actual=JSON.parse(serializeSidSoundDocument(bank,JSON.stringify(source)));
  assert.equal(actual.format,'tetorica-sid-voice');assert.deepEqual(actual,bank.channels[2]);assert.deepEqual(bank,before);
});
test('legacy portable voice keeps version1 for6581 and explicitly upgrades for8580',()=>{
  const bank=createChannelSettings(),source=createDefaultPreset();delete source.model;source.version=1;
  const first=JSON.parse(serializeSidSoundDocument(bank,JSON.stringify(source)));
  assert.equal(first.version,1);assert.equal(Object.hasOwn(first,'model'),false);assert.deepEqual(readPreset(first),bank.channels[0]);
  for(const voice of bank.channels)voice.model='8580';
  const next=JSON.parse(serializeSidSoundDocument(bank,JSON.stringify(source)));
  assert.equal(next.version,2);assert.equal(next.model,'8580');assert.deepEqual(readPreset(next),bank.channels[0]);
});
test('channel setup preserves three distinct voices and compatible legacyversion',()=>{
  const bank=createChannelSettings();bank.channels[0].voice.waveform='triangle';bank.channels[1].voice.waveform='pulse';bank.channels[2].voice.waveform='noise';
  const legacy=structuredClone(bank);legacy.version=1;delete legacy.keyboardMode;
  const saved=JSON.parse(serializeSidSoundDocument(bank,JSON.stringify(legacy)));
  assert.equal(saved.version,1);assert.equal(Object.hasOwn(saved,'keyboardMode'),false);assert.deepEqual(readChannelSettings(saved),bank);
  bank.keyboardMode='legato';assert.equal(JSON.parse(serializeSidSoundDocument(bank,JSON.stringify(legacy))).version,2);
});
test('new instrument is a channel setup and malformed linked JSON never silently changes role',()=>{
  const bank=createChannelSettings();assert.deepEqual(JSON.parse(serializeSidSoundDocument(bank)),bank);
  assert.throws(()=>serializeSidSoundDocument(bank,'{unfinished'),SyntaxError);
});
