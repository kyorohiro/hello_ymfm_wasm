import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';
import { createPsgMonitor, applySsgWrite, applyPsgWrite, describePsgMonitor } from './psg_monitor.js?v=ym2610-vgm-2';

// YMFM ssg_effective_clock(): OPN /2, OPNA /4 at the default prescaler.
export function describeToneNotes(state, clock) {
  const desc = describePsgMonitor(state);
  const scale = Math.floor((state.prescale ?? 6) * 2 / 3);
  return desc.channels.map((ch, index) => {
    const ssg = state.kind === 'ssg';
    const hz = ssg ? clock * (state.chip === 'ym2203' ? 2 : 1) / scale / 16 / Math.max(1, ch.period)
      : clock / 32 / (ch.period || 1024);
    const enabled = ssg ? ch.toneEnabled && (ch.envelope || ch.volume > 0) : ch.attenuation < 15;
    const midi = clock > 0 && hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
    return { name: `${ssg ? 'SSG' : 'PSG'} ${index+1}`, midi, keyOn: enabled && midi !== null,
      period: ch.period, envelope: !!ch.envelope, noise: !!ch.noiseEnabled };
  });
}

export function extractToneNotes(source, chipKind) {
  const parser = new Ym2612VGM(source);
  let time = 0;
  const warnings = new Map();
  const warn = text => warnings.set(text, {count:1});
  const groups = [];
  if (['ym2203','ym2608','ym2610'].includes(chipKind)) groups.push({kind:chipKind,state:createPsgMonitor(chipKind),clock:parser.header[`${chipKind}Clock`] & 0x3fffffff});
  if (parser.header.psgClock & 0x3fffffff) groups.push({kind:'psg',state:createPsgMonitor('ym2612'),clock:parser.header.psgClock & 0x3fffffff});
  for (const g of groups) {
    g.channels = [0,1,2].map(i=>({name:`${g.kind === 'psg' ? 'PSG' : `${g.kind.toUpperCase()} SSG`} ${i+1}`, notes:[],active:null,serial:0}));
  }
  function close(ch) { if(ch.active) ch.notes.push({...ch.active,end:time}); ch.active=null; }
  function update(g, retrigger=false) {
    describeToneNotes(g.state,g.clock).forEach((n,i)=>{
      const ch=g.channels[i];
      if(n.envelope) warn('SSG envelope phase/volume is not synthesized; envelope-enabled tones remain on until mixer/volume off. Shape writes retrigger notes.');
      if(n.noise) warn('SSG noise is omitted; mixed tone/noise uses the tone pitch.');
      const trigger=retrigger && n.envelope;
      if(ch.active && n.keyOn && ch.active.midi===n.midi && !trigger) return;
      const wasOn=!!ch.active;
      close(ch);
      if(n.keyOn) {
        if(!wasOn || trigger) ch.serial++;
        ch.active={start:time,midi:n.midi,key:ch.serial};
      }
    });
  }
  const targets={};
  for(const g of groups) {
    if(g.kind==='psg') {
      targets.psg={write:value=>{applyPsgWrite(g.state,value,time);update(g);}};
      warn('PSG noise channel omitted; tone period zero follows Sega PSG (1024).');
      if(parser.header.psgClock & 0x40000000) warn('Dual PSG: only first chip converted');
    } else targets[g.kind]={writeRegister:(r,v,p=0)=>{if(applySsgWrite(g.state,p,r,v,time)) update(g,p===0 && r===13);}, loadAdpcmBMemory:()=>{}, loadAdpcmRom:()=>{}};
  }
  while(true) {
    const event=parser.playStep(targets);
    if(event.type==='wait') parser.consumeWait(targets,event.samples,n=>{time+=n;});
    else if(event.type==='end') break;
  }
  groups.forEach(g=>g.channels.forEach(close));
  return {channels:groups.flatMap(g=>g.channels),warnings,time,parserHeader:parser.header};
}
