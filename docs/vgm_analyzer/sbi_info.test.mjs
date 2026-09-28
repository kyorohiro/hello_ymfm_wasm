import test from 'node:test';
import assert from 'node:assert/strict';
import {createSbi} from './sbi_export.js';
import {midiToSbiPitch, writeSbiPreview, describeSbiVoice, createSbiKeyboardAudio, mountSbiInfo} from './sbi_info.js';

function voice(fourOp) {
  const registers = new Uint8Array(512);
  registers[0x105] = 1; registers[0x104] = fourOp ? 1 : 0;
  for (const slot of [0,3,8,11]) {
    registers[0x20 + slot] = 0x21; registers[0x40 + slot] = 20;
    registers[0x60 + slot] = 0xf0; registers[0x80 + slot] = 0x0f;
  }
  registers[0xc0] = 1; registers[0xc3] = 1;
  return {fourOp, data:createSbi(registers, 'ymf262', 0), name:'voice.sbi', sample:0, channel:0};
}

test('SBI audition pitch reconstructs MIDI frequencies within OPL quantization', () => {
  for (const midi of [24,48,60,69,84,96]) {
    const {fnum, block} = midiToSbiPitch(midi);
    const frequency = 14318180 / 288 * fnum * 2 ** block / 2 ** 20;
    assert.ok(Math.abs(1200 * Math.log2(frequency / (440 * 2 ** ((midi - 69) / 12)))) < 2);
  }
  assert.throws(() => midiToSbiPitch(Infinity), RangeError);
  assert.throws(() => midiToSbiPitch(127), RangeError);
});

test('SBI preview writes OPL3 setup, four operators and a leading channel key-on', () => {
  const registers = new Map(); let address;
  const chip = {reset(){registers.clear();}, write(port, value){if (!(port & 1)) address = value + (port === 2 ? 256 : 0); else registers.set(address,value);}};
  const patch = voice(true); patch.data[47] = 0x27; patch.data[46] = 10; patch.data[57] = 11;
  const keyOff = writeSbiPreview(chip, patch);
  assert.equal(registers.get(0x105),1); assert.equal(registers.get(0x104),1);
  assert.equal(registers.get(0x28),0x27); assert.equal(registers.get(0x2b),0x21);
  assert.equal(registers.get(0xc0),0x3a); assert.equal(registers.get(0xc3),0x3b);
  assert.equal(registers.get(0xb0),keyOff | 32); assert.equal(registers.has(0xb3),false);
  assert.match(describeSbiVoice(patch),/OP3: MUL 7/);
  writeSbiPreview(chip,voice(false)); assert.equal(registers.get(0x104),0); assert.equal(registers.has(0x28),false);
});

for (const fourOp of [false,true]) test(`SBI ${fourOp ? '4op' : '2op'} audition produces finite stereo audio using real OPL3`, async () => {
  const {Ymf262} = await import('../js/ymf262.js');
  const {default:moduleFactory} = await import('../generated/ymf262_wasm.js');
  const chip = await Ymf262.create({moduleFactory});
  try {
    writeSbiPreview(chip, voice(fourOp));
    const pcm = chip.generateStereo(4096);
    assert.ok(pcm.left.every(Number.isFinite)); assert.ok(pcm.left.some(sample => Math.abs(sample) > 0.0001));
    assert.deepEqual(pcm.left,pcm.right);
  } finally { chip.dispose(); }
});

test('SBI audio key-off and stop release the leading channel and queued buffers', () => {
  const sources = [], writes = []; let address;
  const chip = {reset(){}, write(port,value){if (!(port & 1)) address=value; else writes.push([address,value]);}, sampleRate:()=>48000,
    generateStereo:frames=>({left:new Float32Array(frames),right:new Float32Array(frames)})};
  const context = {currentTime:0,createGain:()=>({gain:{},connect(){},disconnect(){}}),
    createBuffer:(_channels,frames)=>({getChannelData:()=>new Float32Array(frames)}),
    createBufferSource(){const source={connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};sources.push(source);return source;}};
  const audio = createSbiKeyboardAudio(chip,context,()=>voice(true),()=>0.3);
  try {
    audio.noteOnMidi(0,69); assert.equal(sources.length,3); assert.ok(writes.at(-1)[1] & 32);
    audio.noteOff(); assert.equal(writes.at(-1)[0],0xb0); assert.equal(writes.at(-1)[1] & 32,0);
    audio.stop(); assert.ok(sources.every(source=>source.stopped));
  } finally { audio.dispose(); }
});

function source() {
  const commands=[0x5a,0x20,1,0x5a,0xb0,32,0x61,100,0,0x5a,0x20,2,0x66];
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,204,true);view.setUint32(0x50,3579545,true);
  bytes.set(commands,256);return bytes;
}
function node() { return {value:'0',children:[],handlers:{},append(child){this.children.push(child);},replaceChildren(){this.children=[];},
  addEventListener(name,handler){this.handlers[name]=handler;},blur(){},click(){}}; }

test('SBI Info lazily extracts, changes voices, downloads matching bytes and clears on file/tab changes', async () => {
  const originalDocument=globalThis.document, originalURL=globalThis.URL, originalTimeout=globalThis.setTimeout;
  const elements=new Map(),views=[],downloads=[],statuses=[];let keyboardOptions, savedBlob;
  globalThis.document={createElement(tag){const result=node();if(tag==='a') result.click=()=>downloads.push(result.download);return result;}};
  globalThis.URL={createObjectURL(blob){savedBlob=blob;return 'blob:test';},revokeObjectURL(){}};
  globalThis.setTimeout=callback=>callback();
  const root={querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);}};
  const panel=mountSbiInfo({root,onStatus:message=>statuses.push(message),createKeyboard(options){keyboardOptions=options;return {setView:value=>views.push(value),dispose(){}};}});
  try {
    panel.loadVgm(source());assert.equal(elements.get('select').children.length,0);
    panel.setVisible(true);assert.equal(elements.get('select').children.length,2);assert.equal(views.at(-1),'operator');
    assert.equal(keyboardOptions.idPrefix,'sbi-');assert.match(elements.get('.sbi-voice').textContent,/OP1: MUL 1/);
    elements.get('select').value='1';elements.get('select').handlers.change();
    assert.match(elements.get('.sbi-voice').textContent,/OP1: MUL 2/);
    elements.get('.sbi-save').handlers.click();assert.deepEqual(downloads,['CH1_002.sbi']);
    assert.equal(new Uint8Array(await savedBlob.arrayBuffer())[36],2);
    panel.setVisible(false);assert.equal(views.at(-1),'code');assert.equal(root.hidden,true);
    panel.loadVgm(null);assert.equal(elements.get('.sbi-save').disabled,true);assert.equal(elements.get('.sbi-voice').textContent,'');
    const dual=source();new DataView(dual.buffer).setUint32(0x50,0x40000000|3579545,true);
    panel.loadVgm(dual);panel.setVisible(true);assert.match(statuses.at(-1),/SBI extraction failed/);
    assert.equal(elements.get('.sbi-save').disabled,true);assert.equal(views.at(-1),'code');
  } finally {
    await panel.dispose();globalThis.document=originalDocument;globalThis.URL=originalURL;globalThis.setTimeout=originalTimeout;
  }
});

test('disposing SBI Info during chip initialization releases late resources', async () => {
  const elements=new Map();let options, finish, chipDisposed=0, closed=0, attached=0;
  const root={querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);}};
  const panel=mountSbiInfo({root,onStatus(){},createKeyboard(value){options=value;return {setView(){},dispose(){},attachSynth(){attached++;}};},
    createContext:()=>({resume:async()=>{},close:async()=>{closed++;}}),createChip:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=options.ensureAudioReady();await Promise.resolve();
  const disposing=panel.dispose();finish({dispose(){chipDisposed++;}});
  await Promise.all([pending,disposing]);assert.equal(chipDisposed,1);assert.equal(closed,1);assert.equal(attached,0);
});
