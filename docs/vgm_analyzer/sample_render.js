import {decodeYmf278bSample} from './ymf278b_samples.js';
import {Rf5c164} from '../js/rf5c164.js';
import {Ym2608} from '../js/ym2608.js';
import {Ym2610B} from '../js/ym2610b.js';
import {renderDacPreview} from './dac_samples.js';
import {renderPwmPreview} from './pwm_samples.js';
import {encodeStereoWav} from './vgm_wav.js';

export async function renderSamplePreview(sample,event,{getFactory}={}) {
  if(!sample.data)throw new Error('Sample has missing/partial data');
  if(sample.chip==='ymf278b'){
    const data=decodeYmf278bSample(sample),rate=event.rate;
    if(!(rate>0))throw new Error('Sample rate is zero');
    const mono=new Float32Array(Math.min(441000,Math.ceil(data.length/rate*44100)));
    for(let i=0;i<mono.length;i++)mono[i]=data[Math.min(data.length-1,Math.floor(i*rate/44100))];
    return {left:mono,right:mono,sampleRate:44100};
  }
  if(sample.kind==='pwm')return {...renderPwmPreview(sample),sampleRate:44100};
  if(sample.kind==='dac'){const mono=renderDacPreview(sample);return {left:mono,right:mono,sampleRate:44100};}
  if(!(event.rate>0))throw new Error('Sample rate is zero');
  const recipe={rf5c164:['rf5c164',Rf5c164],ym2608:['ym2608',Ym2608],ym2610:['ym2610b',Ym2610B]}[sample.chip];
  if(!recipe)throw new Error('Unsupported sample chip');
  const factory=await getFactory?.(recipe[0]);
  if(!factory)throw new Error('Missing sample factory: '+recipe[0]);
  const chip=await recipe[1].create({moduleFactory:factory,clock:event.clock});
  try{
    configureSamplePreview(chip,sample,event);
    const sampleRate=chip.sampleRate(event.clock);
    const frames=Math.min(Math.ceil(sampleRate*10),Math.ceil(sample.size*2/event.rate*sampleRate)+1024);
    const pcm=chip.generateStereo(frames);
    // Engine buffers may be backed by WASM memory; copy before disposal.
    return {left:pcm.left.slice(),right:pcm.right.slice(),sampleRate};
  }finally{chip.dispose();}
}
export async function samplePreviewWav(sample,event,options){
  const pcm=await renderSamplePreview(sample,event,options);
  return {bytes:encodeStereoWav(pcm.left,pcm.right,Math.round(pcm.sampleRate)),
    sampleRate:Math.round(pcm.sampleRate),seconds:pcm.left.length/Math.round(pcm.sampleRate)};
}

// Preview one pass of the selected occurrence, centered; repeat is not expanded.
export function configureSamplePreview(chip, sample, event) {
  if(sample.chip==='rf5c164') {
    chip.loadMemory(sample.data);
    chip.writeRegister(7,0xc0);
    event.settings.forEach((v,r)=>chip.writeRegister(r,r===1?0xff:v));
    chip.writeRegister(8,0xfe);
    return;
  }
  if (sample.chip === 'ym2608') {
    chip.loadAdpcmBMemory(sample.data, sample.byteStart, sample.byteEndExclusive);
    // Restore the observed prescaler through address writes.
    chip.write(0, 0x2d);
    if (event.prescale !== 6) chip.write(0, event.prescale === 3 ? 0x2e : 0x2f);
    const write = (r, v) => { chip.write(2, r); chip.write(3, v); };
    write(1, 0xc0 | event.memoryMode);
    write(2, event.rawStart & 255); write(3, event.rawStart >> 8);
    write(4, event.rawEnd & 255); write(5, event.rawEnd >> 8);
    write(12, event.limit & 255); write(13, event.limit >> 8);
    write(9, event.deltaN & 255); write(10, event.deltaN >> 8); write(11, event.level);
    write(0, 0xa0 | (event.speakerOff ? 8 : 0));
    return;
  }
  chip.loadAdpcmRom(sample.romType, sample.data, sample.byteStart, sample.byteEndExclusive);
  const write = (r, v) => { const port = sample.romType === 0 ? 2 : 0; chip.write(port, r); chip.write(port + 1, v); };
  if (sample.romType === 0) {
    write(1, event.totalLevel); write(8, 0xc0 | event.level);
    write(0x10, event.rawStart & 255); write(0x18, event.rawStart >> 8);
    write(0x20, event.rawEnd & 255); write(0x28, event.rawEnd >> 8); write(0, 1);
  } else {
    write(0x11, 0xc0); write(0x12, event.rawStart & 255); write(0x13, event.rawStart >> 8);
    write(0x14, event.rawEnd & 255); write(0x15, event.rawEnd >> 8);
    write(0x19, event.deltaN & 255); write(0x1a, event.deltaN >> 8); write(0x1b, event.level);
    write(0x10, 0x80 | (event.speakerOff ? 8 : 0));
  }
}
