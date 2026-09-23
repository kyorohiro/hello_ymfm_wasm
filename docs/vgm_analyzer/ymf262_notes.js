import {Ym2612VGM} from '../js/ym2612vgm.js?v=ym2610-vgm-2';

export const createOpl3Monitor = () => new Uint8Array(512);
export function applyOpl3Write(regs, register, value, port=0) {
  let addr=register+(port?256:0);
  if(!(regs[0x105]&1)&&addr!==0x105)addr&=255;
  regs[addr]=value;
}
export function describeOpl3Notes(regs, clock, chipKind = 'ymf262') {
  const pairs=regs[0x104]&63, rhythm=!!(regs[0xbd]&32);
  return Array.from({length:18},(_,i)=>{
    const bank=i>=9?1:0, local=i%9, addr=bank*256+local;
    const paired=local<6&&!!(pairs&(1<<(bank*3+local%3)));
    const slave=paired&&local>=3, percussion=rhythm&&i>=6&&i<=8;
    const fnum=regs[0xa0+addr]|((regs[0xb0+addr]&3)<<8), block=(regs[0xb0+addr]>>2)&7;
    // YMF278B clocks FM 192/171 times per PCM sample (clock/768), i.e. clock/684.
    const freq=clock/(chipKind === 'ymf278b' ? 684 : 288)*fnum*2**block/2**20;
    return {paired,slave,percussion,fnum,block,freq,keyOn:!slave&&!percussion&&!!(regs[0xb0+addr]&32),
      midi:freq>0?69+12*Math.log2(freq/440):null};
  });
}

/** OPL3 base FNUM/BLOCK transcription, not synthesized pitch detection.
 * Pair mapping and compatibility address masking follow src/ymfm_opl.cpp.
 * Four operators share the leading channel's pitch/key; the partner is not a staff voice.
 */
export function extractOpl3Notes(source, chipKind = 'ymf262') {
  if (!['ymf262', 'ymf278b'].includes(chipKind)) throw new Error('Unsupported OPL3 chip');
  const label=chipKind.toUpperCase();
  let time=0;
  const warnings=new Map();
  const warn=message=>warnings.set(message,{count:(warnings.get(message)?.count??0)+1});
  const parser=new Ym2612VGM(source,{logger:{warn}});
  const raw=parser.header[`${chipKind}Clock`], clock=raw&0x3fffffff;
  if(!clock)throw new Error(`${label} clock is required`);
  if(raw&0xc0000000)throw new Error(`Dual/variant ${label} note extraction is not supported`);
  warn(`${label}: FNUM/BLOCK base pitch only; operator multipliers, tuning, envelopes, vibrato and audible release are not reproduced. 4op pairs use the leading channel.`);
  if (chipKind === 'ymf278b') warn('YMF278B: PCM voices are omitted from Note-ish.');
  const regs=createOpl3Monitor();
  const channels=Array.from({length:18},(_,i)=>({name:`${label}${chipKind === 'ymf278b' ? ' FM' : ''} CH${i+1}`,notes:[],active:null,serial:0,gate:false,paired:false}));
  const close=ch=>{if(ch.active&&time>ch.active.start)ch.notes.push({...ch.active,end:time});ch.active=null;};
  function update() {
    for(const [i,note] of describeOpl3Notes(regs,clock,chipKind).entries()) {
      const ch=channels[i], {paired,midi,keyOn:gate}=note;
      // Gate intervals are recorded even when routing/TL makes them silent: base-note score.
      // NEW controls bank addressing/output routing; retained register state is not reset by NEW.
      if(gate!==ch.gate||paired!==ch.paired||ch.active?.midi!==midi) {
        close(ch);
        if(gate&&(!ch.gate||paired!==ch.paired))ch.serial++;
        if(gate)ch.active={start:time,midi,key:ch.serial};
      }
      ch.gate=gate;ch.paired=paired;
    }
  }
  const targets={[chipKind]:{writeRegister(register,value,port=0){
    if (port !== 0 && port !== 1) return; // Port 2 is PCM, never an FM bank.
    let addr=register+(port?256:0);
    if(!(regs[0x105]&1)&&addr!==0x105)addr&=255;
    const prev=regs[addr];applyOpl3Write(regs,register,value,port);
    if(addr===0xbd&&(value&32)&&!(prev&32))warn(`${label} rhythm mode: CH7–CH9 percussion is omitted from notes.`);
    if(addr===0x104||addr===0x105||addr===0xbd||(register>=0xa0&&register<=0xb8))update();
  }}};
  while(true){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>{time+=n;});else if(event.type==='end')break;}
  channels.forEach(close);
  return {channels:channels.map(({name,notes})=>({name,notes})),time,warnings,parserHeader:parser.header};
}

export const extractYmf278bFmNotes = source => extractOpl3Notes(source, 'ymf278b');
