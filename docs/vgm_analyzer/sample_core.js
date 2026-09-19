import {samplePreviewWav} from './sample_render.js';
import {createStoredZipBytes} from './stored_zip.js';
import {createDacSamples} from './dac_samples.js';
import {pwmCaptureJson,createPwmSamples} from './pwm_samples.js';
import {createRf5c164Samples} from './rf5c164_samples.js';
import {Ym2612VGM} from '../js/ym2612vgm.js?v=pwm-2';

// One pass; never expands the VGM loop. Memory is resolved at each key-on.
export async function extractSamples(source, { signal } = {}) {
  const warnings = new Set();
  const parser = new Ym2612VGM(source, { logger: { warn: m => warnings.add(m) } });
  const dac = createDacSamples();
  const pwm = createPwmSamples();
  const rf = createRf5c164Samples(parser.header.rf5c164Clock & 0x3fffffff);
  const clock = parser.header.ym2610Clock & 0x3fffffff;
  const regs = new Uint8Array(256), samples = [], events = [], definitions = new Map();
  let retainedBytes = 0;
  const memories = [0, 1, 2].map(() => ({ data: new Uint8Array(0), present: new Uint8Array(0), generation: 0 }));
  const opna = new Uint8Array(16);
  let prescale = 6, writeAddress = 0, pendingWriteStart = false;
  const opnaUnit = () => opna[1] & 3 ? 32 : 4;
  const bregs = new Uint8Array(16);
  let time = 0;
  if (parser.header.ym2610Clock & 0x40000000) warnings.add('Second YM2610 chip is not analyzed.');
  function observe(kind, channel, control, chip = 'ym2610') {
    const previous = events.findLast(x => x.chip === chip && x.kind === kind && x.channel === channel);
    if (previous && previous.nextControlTime == null) {
      previous.nextControlTime = time; previous.nextControl = control;
    }
  }
  function begin(kind, channel, rawStart, rawEnd, settings) {
    const romType = kind === 'adpcm-a' ? 0 : 1;
    const chip = settings.chip ?? 'ym2610', unit = settings.addressUnit ?? 256;
    const memory = memories[chip === 'ym2608' ? 2 : romType], byteStart = rawStart * unit;
    const size = romType === 0 ? ((((rawEnd + 1) * 256 - byteStart) & 0xfffff) || 0x100000)
      : (rawEnd + 1) * unit - byteStart;
    if (size <= 0) { warnings.add('ADPCM-B wrapped address range is not extracted.'); return; }
    const byteEndExclusive = byteStart + size;
    const key = `${chip}:${kind}:${memory.generation}:${byteStart}:${byteEndExclusive}`;
    let sample = definitions.get(key);
    if (!sample) {
      if (retainedBytes + size > 64 * 1024 * 1024) throw new Error('Sample analysis exceeds the 64 MiB limit.');
      const data = new Uint8Array(size);
      let available = 0;
      for (let i = 0; i < size; i++) {
        const a = byteStart + i;
        if (memory.present[a]) { data[i] = memory.data[a]; available++; }
      }
      sample = { id: samples.length + 1, chip, kind, romType, generation: memory.generation,
        byteStart, byteEndExclusive, size, available, data: available === size ? data : null };
      retainedBytes += sample.data ? size : 0;
      samples.push(sample); definitions.set(key, sample);
    }
    if (events.length >= 100000) throw new Error('Sample analysis exceeds 100,000 playback events.');
    events.push({ sampleId: sample.id, chip, kind, channel, startTime: time,
      endTime: null, endReason: 'unknown', rawStart, rawEnd, clock, ...settings });
  }
  function apply(e) {
    rf.apply(e, time);
    if (e.type === 'ym2610-rom-data' || e.type === 'ym2608-adpcm-b-data') {
      if (e.chipIndex) { warnings.add('Second chip sample memory is not analyzed.'); return; }
      const memory = memories[e.type === 'ym2608-adpcm-b-data' ? 2 : e.romType];
      if (!memory) return;
      if (e.memorySize > memory.data.length) {
        const capacity = Math.ceil(e.memorySize / 4096) * 4096;
        const next = new Uint8Array(capacity), coverage = new Uint8Array(capacity);
        next.set(memory.data); coverage.set(memory.present); memory.data = next; memory.present = coverage;
      }
      let changed = false;
      e.data.forEach((v, i) => { const a = e.offset + i; changed ||= !memory.present[a] || memory.data[a] !== v; memory.data[a] = v; memory.present[a] = 1; });
      if (changed) memory.generation++;
    }
    if (e.type === 'ym2608-write') {
      const { register: r, value: v } = e;
      if (e.port === 0) {
        if (r === 0x2d) prescale = 6;
        if (r === 0x2e && prescale === 6) prescale = 3;
        if (r === 0x2f) prescale = 2;
        return;
      }
      if (r > 15) return;
      opna[r] = v;
      if (r === 8 && (opna[0] & 0xe0) === 0x60) {
        // Mirror ymfm's CPU memory-write mode, including its end comparison.
        if (pendingWriteStart) {
          writeAddress = (opna[2] | opna[3] << 8) * opnaUnit(); pendingWriteStart = false;
        }
        const end = ((opna[4] | opna[5] << 8) + 1) * opnaUnit() - 1;
        if (writeAddress !== end && writeAddress < 0x200000) {
          apply({ type: 'ym2608-adpcm-b-data', chipIndex: 0, memorySize: writeAddress + 1,
            offset: writeAddress++, data: Uint8Array.of(v) });
        }
      }
      if (r !== 0) return;
      pendingWriteStart = Boolean(v & 0x20);
      if (v & 1) { writeAddress = 0; }
      observe('adpcm-b', 1, v & 1 ? 'reset' : v & 128 ? 'restart' : 'stop', 'ym2608');
      if (!(v & 128) || (v & 1)) return;
      if ((v & 0x60) !== 0x20) {
        warnings.add('YM2608 CPU-driven playback / recording is not extracted.'); return;
      }
      const unit = opnaUnit(), rawStart = opna[2] | opna[3] << 8, rawEnd = opna[4] | opna[5] << 8;
      const limit = opna[12] | opna[13] << 8;
      if (rawStart <= limit && limit < rawEnd) {
        warnings.add('YM2608 ADPCM-B limit-wrapped playback is not extracted.'); return;
      }
      const deltaN = opna[9] | opna[10] << 8, chipClock = parser.header.ym2608Clock & 0x3fffffff;
      begin('adpcm-b', 1, rawStart, rawEnd, { chip: 'ym2608', clock: chipClock,
        addressUnit: unit, memoryMode: opna[1] & 3, limit, prescale,
        level: opna[11], pan: opna[1] >> 6, deltaN,
        rate: chipClock / (24 * prescale) * deltaN / 65536,
        loop: Boolean(v & 16), speakerOff: Boolean(v & 8) });
      return;
    }
    if (e.type !== 'ym2610-write') return;
    const { register: r, value: v } = e;
    if (e.port === 0) {
      if (r < 0x10 || r > 0x1b) return;
      bregs[r - 0x10] = v;
      if (r !== 0x10) return;
      // YM2610 forces external playback and ignores the recording bit.
      observe('adpcm-b', 1, v & 1 ? 'reset' : v & 128 ? 'restart' : 'stop');
      if (!(v & 128) || (v & 1)) return;
      const deltaN = bregs[9] | bregs[10] << 8;
      begin('adpcm-b', 1, bregs[2] | bregs[3] << 8, bregs[4] | bregs[5] << 8,
        { level: bregs[11], pan: bregs[1] >> 6, deltaN,
          rate: clock / 144 * deltaN / 65536, loop: Boolean(v & 16), speakerOff: Boolean(v & 8) });
      return;
    }
    regs[r] = v;
    if (r !== 0) return;
    for (let ch = 0; ch < 6; ch++) {
      if (!(v & (1 << ch))) continue;
      // A later stop does not prove that natural EOS hadn't already occurred.
      observe('adpcm-a', ch + 1, v & 128 ? 'stop' : 'restart');
      if (v & 128) continue;
      begin('adpcm-a', ch + 1, regs[0x10 + ch] | regs[0x18 + ch] << 8,
        regs[0x20 + ch] | regs[0x28 + ch] << 8,
        { level: regs[8 + ch] & 31, totalLevel: regs[1] & 63,
          pan: regs[8 + ch] >> 6, rate: clock / 432, loop: false });
    }
  }
  const targets = {
    pwm: { writeRegister: (r,v) => pwm.write(r,v,time) },
    ym2612: { writeRegister: (r,v,p=0) => dac.write(r,v,p,time) },
    ym2610: {writeRegister() {},loadAdpcmRom() {}},
    ym2608: {writeRegister() {},loadAdpcmBMemory() {}},
    ym2203: {writeRegister() {}}, psg: {write() {}},
    rf5c164: {writeRegister() {},writeMemory() {},loadBankedMemory(data,offset) {
      rf.apply({type:'rf5c164-data',data,offset,chipIndex:0},time);
    }}
  };
  for (let count = 0; ; count++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const e = parser.playStep(targets);
    if (e.type === 'end') break;
    if (e.type === 'wait') parser.consumeWait(targets,e.samples,n=>{time+=n;dac.advance(time);pwm.advance(time);});
    else if (e.type === 'rf5c164-data') {} // applied through playback target
    else apply(e);
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (parser.header.ym2608Clock & 0x40000000) warnings.add('Second YM2608 chip is not analyzed.');
  dac.finish(time,'VGM end');
  pwm.finish(time,'VGM end');
  const pwmBase=samples.length;
  for(const sample of pwm.samples)samples.push({...sample,id:sample.id+pwmBase});
  for(const event of pwm.events)events.push({...event,sampleId:event.sampleId+pwmBase});
  if(pwm.samples.length)warnings.add('PWM captures are mixed output, split into 10-second windows, not original instruments. Stereo preview/WAV uses approximate PWM conversion; timed JSON preserves register writes.');
  const dacBase=samples.length;
  for(const sample of dac.samples)samples.push({...sample,id:sample.id+dacBase});
  for(const event of dac.events)events.push({...event,sampleId:event.sampleId+dacBase});
  if(dac.samples.length)warnings.add('DAC captures are split at disable/end or 10-second display windows, not original sample boundaries. Preview is centered, without analog filtering.');
  const baseId=samples.length;
  for(const sample of rf.samples) samples.push({...sample,id:sample.id+baseId});
  for(const event of rf.events) events.push({...event,sampleId:event.sampleId+baseId});
  for(const warning of rf.warnings)warnings.add(warning);
  warnings.add('Initial support: YM2610 / YM2610B ADPCM-A / ADPCM-B and YM2608 ADPCM-B, RF5C164 PCM. Rhythm, end times and live parameter changes are not reconstructed.');
  return { samples, events, clock, warnings: [...warnings], time };
}


export async function listSamples(bytes, options) {
  const result=await extractSamples(bytes,options);
  return sampleInventory(result);
}

function sampleInventory(result) {
  return {schemaVersion:1,timebase:44100,time:result.time,warnings:result.warnings,
    samples:result.samples.map(({data,times,registers,...metadata})=>({
      ...metadata,exportable:data!==null && data!==undefined,
      representation:metadata.kind==='dac'||metadata.kind==='pwm'?'timed-output':metadata.chip==='rf5c164'?'ram-snapshot':'raw-adpcm',
    })),events:result.events};
}


// Native Browser save format: raw ADPCM/RAM bytes or timed output JSON.
export function sampleFile(sample, events) {
  if (!sample.data) throw new Error('Sample '+sample.id+' has missing/partial data');
  const first=events.find(e=>e.sampleId===sample.id);
  const captured=sample.kind==='dac'||sample.kind==='pwm';
  const text=sample.kind==='pwm'?pwmCaptureJson(sample,first.startTime):
    sample.kind==='dac'?JSON.stringify({timebase:44100,startTime:first.startTime,duration:sample.duration,boundary:sample.boundary,times:[...sample.times],values:[...sample.data]}):null;
  return {name:sample.chip+'-'+sample.kind+'-'+sample.id+(captured?'.json':'.bin'),
    bytes:text===null?sample.data.slice():new TextEncoder().encode(text)};
}

export async function exportSamples(bytes,{id,all=false,signal,format='native',occurrence=1,getFactory}={}) {
  if(typeof all!=='boolean' || (all ? id!==undefined : !Number.isSafeInteger(id)||id<1)) throw new Error('Specify a positive sample id or all:true, exclusively');
  if(!['native','wav'].includes(format))throw new Error('Sample format must be native or wav');
  if(!Number.isSafeInteger(occurrence)||occurrence<1)throw new Error('Occurrence must be a positive integer');
  if(format==='wav' && all)throw new Error('WAV export requires one sample ID');
  if(format==='native' && occurrence!==1)throw new Error('Occurrence applies only to WAV');
  const result=await extractSamples(bytes,{signal});
  const selected=all?result.samples:result.samples.filter(s=>s.id===id);
  if(!selected.length) throw new Error(all?'No supported samples found':'Unknown sample id: '+id);
  // Fail the entire request before writing any output if one definition is unavailable.
  if(format==='wav'){
    const uses=result.events.filter(e=>e.sampleId===id),event=uses[occurrence-1];
    if(!event)throw new Error('Unknown sample occurrence');
    const wav=await samplePreviewWav(selected[0],event,{getFactory});
    return {...wav,warnings:[...result.warnings,'WAV follows Browser preview: centered ADPCM/PCM, stereo PWM, at most 10 seconds; duration is a preview estimate, not detected sample end. RF5C164 loop markers may repeat within this window.']};
  }
  const files=selected.map(s=>sampleFile(s,result.events));
  const manifest=sampleInventory(result);
  if(!all)return {...files[0],warnings:result.warnings};
  return {bytes:createStoredZipBytes([
    ...files.map(f=>({name:f.name,data:f.bytes})),
    {name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))},
  ]),count:files.length,warnings:result.warnings};
}
