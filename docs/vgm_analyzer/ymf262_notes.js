import {Ym2612VGM} from '../js/ym2612vgm.js?v=ym2610-vgm-2';

/** OPL3 base FNUM/BLOCK transcription, not synthesized pitch detection.
 * Pair mapping and compatibility address masking follow src/ymfm_opl.cpp.
 * Four operators share the leading channel's pitch/key; the partner is not a staff voice.
 */
export function extractOpl3Notes(source) {
  let time=0;
  const warnings=new Map();
  const warn=message=>warnings.set(message,{count:(warnings.get(message)?.count??0)+1});
  const parser=new Ym2612VGM(source,{logger:{warn}});
  const raw=parser.header.ymf262Clock, clock=raw&0x3fffffff;
  if(!clock)throw new Error('YMF262 clock is required');
  if(raw&0xc0000000)throw new Error('Dual/variant YMF262 score extraction is not supported');
  warn('YMF262: FNUM/BLOCK base pitch only; operator multipliers, tuning, envelopes, vibrato and audible release are not reproduced. 4op pairs use the leading channel.');
  const regs=new Uint8Array(512);
  const channels=Array.from({length:18},(_,i)=>({name:`YMF262 CH${i+1}`,notes:[],active:null,serial:0,gate:false,paired:false}));
  const close=ch=>{if(ch.active&&time>ch.active.start)ch.notes.push({...ch.active,end:time});ch.active=null;};
  function update() {
    const pairs=regs[0x104]&63, rhythm=!!(regs[0xbd]&32);
    for(let i=0;i<18;i++) {
      const bank=i>=9?1:0, local=i%9, addr=bank*256+local, ch=channels[i];
      const paired=local<6&&!!(pairs&(1<<(bank*3+local%3)));
      const slave=paired&&local>=3;
      const gate=!slave&&!(rhythm&&i>=6&&i<=8)&&!!(regs[0xb0+addr]&32);
      const fnum=regs[0xa0+addr]|((regs[0xb0+addr]&3)<<8), block=(regs[0xb0+addr]>>2)&7;
      const hz=clock/288*fnum*2**block/2**20;
      const midi=hz>0?69+12*Math.log2(hz/440):null;
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
  const targets={ymf262:{writeRegister(register,value,port=0){
    let addr=register+(port?256:0);
    if(!(regs[0x105]&1)&&addr!==0x105)addr&=255;
    const prev=regs[addr];regs[addr]=value;
    if(addr===0xbd&&(value&32)&&!(prev&32))warn('YMF262 rhythm mode: CH7–CH9 percussion is omitted from the score.');
    if(addr===0x104||addr===0x105||addr===0xbd||(register>=0xa0&&register<=0xb8))update();
  }}};
  while(true){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>{time+=n;});else if(event.type==='end')break;}
  channels.forEach(close);
  return {channels:channels.map(({name,notes})=>({name,notes})),time,warnings,parserHeader:parser.header};
}
