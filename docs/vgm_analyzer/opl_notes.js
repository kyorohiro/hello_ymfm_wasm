import {Ym2612VGM} from '../js/ym2612vgm.js';

export const isOpl = kind => kind === 'ym3526' || kind === 'ym3812' || kind === 'y8950';
export const oplChipKind = header => ['ym3526','ym3812','y8950'].find(k => header[`${k}Clock`] & 0x3fffffff) ?? null;
export const createOplMonitor = () => new Uint8Array(256);
export function applyOplWrite(regs, register, value) { if (register >= 0 && register < 256) regs[register] = value; }
// Register layout and operator mapping: src/ymfm_opl.h and src/ymfm_opl.cpp.
const slots = [0,1,2,8,9,10,16,17,18];
export function describeOplNotes(regs, clock) {
  return Array.from({length:9}, (_, ch) => {
    const fnum = regs[0xa0+ch] | (regs[0xb0+ch]&3)<<8, block = regs[0xb0+ch]>>2&7;
    const percussion = !!(regs[0xbd]&32) && ch >= 6, csm = !!(regs[8]&128);
    const freq = clock / 72 * fnum * 2**block / 2**20;
    return {fnum, block, freq, percussion, csm, keyOn: !percussion && !csm && !!(regs[0xb0+ch]&32),
      midi: fnum ? 69 + 12*Math.log2(freq/440) : null};
  });
}
export function snapshotOpl(regs, kind, clock) {
  if (!isOpl(kind)) throw new Error('OPL snapshot requires YM3526, YM3812 or Y8950');
  const waveEnabled = kind === 'ym3812' && !!(regs[1]&32);
  return {format:'tetorica-opl-snapshot', version:1, chip:kind, clock,
    description:'Register-state snapshot, not an envelope or audio snapshot. Rhythm shares CH7–9 operators.',
    registers:Array.from(regs), rhythm:regs[0xbd], csm:!!(regs[8]&128), waveformEnabled:waveEnabled,
    channels:describeOplNotes(regs,clock).map((note,ch) => ({channel:ch+1,...note,
      connection:regs[0xc0+ch]&1, feedback:regs[0xc0+ch]>>1&7,
      operators:[slots[ch],slots[ch]+3].map(offset => {
        const a=regs[0x20+offset], b=regs[0x40+offset], c=regs[0x60+offset], d=regs[0x80+offset];
        return {offset, am:!!(a&128), vibrato:!!(a&64), sustain:!!(a&32), ksr:!!(a&16), multiplier:a&15,
          ksl:b>>6, totalLevel:b&63, attack:c>>4, decay:c&15, sustainLevel:d>>4, release:d&15,
          waveform:waveEnabled ? regs[0xe0+offset]&3 : 0, waveformRegister:regs[0xe0+offset]};
      })}))};
}
export function extractOplNotes(source) {
  const warnings=new Map(), warn=message=>warnings.set(message,{count:(warnings.get(message)?.count??0)+1});
  const parser=new Ym2612VGM(source,{logger:{warn}}), kind=oplChipKind(parser.header);
  if (!kind) throw new Error('YM3526, YM3812 or Y8950 clock is required');
  if (['ym3526','ym3812','y8950'].filter(k=>parser.header[`${k}Clock`]&0x3fffffff).length!==1 || parser.header[`${kind}Clock`]&0xc0000000)
    throw new Error('Dual/variant or mixed OPL/OPL2 note extraction is not supported');
  const clock=parser.header[`${kind}Clock`]&0x3fffffff, regs=createOplMonitor();
  let time=0;
  warn(`${kind.toUpperCase()}: FNUM/BLOCK base pitch only; timbre, multipliers, vibrato, envelopes and audible release are not reproduced.`);
  if(kind==='y8950')warn('Y8950 ADPCM is omitted from pitched notes; only FM base pitches are extracted.');
  const channels=Array.from({length:9},(_,i)=>({name:`${kind.toUpperCase()} CH${i+1}`,notes:[],active:null,serial:0,gate:false}));
  const close=ch=>{if(ch.active && time>ch.active.start) ch.notes.push({...ch.active,end:time});ch.active=null;};
  const targets = {[kind]:{writeRegister(r,v){
    const old=regs[r];applyOplWrite(regs,r,v);
    if(r===0xbd && v&32 && !(old&32))warn('OPL rhythm mode: CH7–CH9 percussion is omitted from notes.');
    if(r===8 && v&128 && !(old&128))warn('OPL CSM intervals are omitted from notes.');
    if(r!==8 && r!==0xbd && !(r>=0xa0&&r<=0xb8))return;
    describeOplNotes(regs,clock).forEach((n,i)=>{
      const ch=channels[i];
      if(n.keyOn!==ch.gate || ch.active?.midi!==n.midi) {
        close(ch);
        if(n.keyOn&&!ch.gate)ch.serial++;
        if(n.keyOn)ch.active={start:time,midi:n.midi,key:ch.serial};
      }
      ch.gate=n.keyOn;
    });
  }}};
  while(true){const e=parser.playStep(targets);if(e.type==='wait')parser.consumeWait(targets,e.samples,n=>{time+=n;});else if(e.type==='end')break;}
  channels.forEach(close);
  return {channels:channels.map(({name,notes})=>({name,notes})),time,warnings,parserHeader:parser.header};
}
