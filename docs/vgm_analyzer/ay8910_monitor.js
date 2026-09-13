// This monitor reports register state, not an inferred envelope phase.
export function describeAy8910(registers,clock,type=0,flags=1) {
  const divider=type===0x10 && (flags&16)?2:1;
  return Array.from({length:3},(_,ch)=>{
    const period=registers[ch*2]|((registers[ch*2+1]&15)<<8);
    const tone=!(registers[7]&(1<<ch)),noise=!(registers[7]&(8<<ch));
    const envelope=Boolean(registers[8+ch]&16),volume=registers[8+ch]&15;
    const frequency=clock/(16*divider*Math.max(1,period));
    const midi=69+12*Math.log2(frequency/440);
    return {channel:ch,period,tone,noise,envelope,volume,frequency,
      midi:tone&&(envelope||volume>0)?midi:null};
  });
}
export function mountAy8910Monitor(root,onMute) {
  const regs=new Uint8Array(16), muted=[false,false,false];
  let header={};
  const title=document.createElement('h3');root.append(title);
  const summary=document.createElement('p');root.append(summary);
  const rows=muted.map((_,ch)=>{
    const row=document.createElement('p'),label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');
    check.type='checkbox';check.addEventListener('change',()=>{muted[ch]=check.checked;onMute(ch,check.checked);check.blur();});
    label.append(check,` Mute ${'ABC'[ch]} `);row.append(label,text);root.append(row);
    return {check,text};
  });
  const ayMute=document.createElement('input');ayMute.type='checkbox';
  const ayLabel=document.createElement('label');ayLabel.append(ayMute,' Mute AY / YM2149 ');root.append(ayLabel);
  ayMute.addEventListener('change',()=>{onMute('ay',ayMute.checked);ayMute.blur();});
  const opllMute=document.createElement('input');opllMute.type='checkbox';
  const opllLabel=document.createElement('label');opllLabel.append(opllMute,' Mute YM2413');root.append(opllLabel);
  opllMute.addEventListener('change',()=>{onMute('opll',opllMute.checked);opllMute.blur();});
  function render(){
    title.textContent=header.ay8910Type===0x10?'YM2149':'AY-3-8910';
    const clock=header.ay8910Clock&0x3fffffff;
    summary.textContent=`Clock: ${clock} Hz · Noise period: ${regs[6]&31} · Envelope period: ${regs[11]|(regs[12]<<8)} · Shape: ${regs[13]&15}`;
    describeAy8910(regs,clock,header.ay8910Type,header.ay8910Flags).forEach((ch,i)=>{
      const note=ch.midi===null?'—':`${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((Math.round(ch.midi)%12)+12)%12]}${Math.floor(Math.round(ch.midi)/12)-1} (${ch.frequency.toFixed(1)} Hz)`;
      rows[i].text.textContent=`Tone: ${ch.tone?'On':'Off'} · Noise: ${ch.noise?'On':'Off'} · ${ch.envelope?'Envelope':'Volume: '+ch.volume} · Tone pitch: ${note}`;
    });
  }
  return {
    render,
    load(next){header=next;regs.fill(0);muted.fill(false);for(const row of rows)row.check.checked=false;ayMute.checked=opllMute.checked=false;opllLabel.hidden=!header.ym2413Clock;render();},
    reset(){regs.fill(0);render();},
    write(r,v){regs[r&15]=v;},
    applyMutes(engine){muted.forEach((v,ch)=>engine.setAyChannelMuted(ch,v));engine.setAyMuted(ayMute.checked);engine.setOpllMuted?.(opllMute.checked);},
  };
}
