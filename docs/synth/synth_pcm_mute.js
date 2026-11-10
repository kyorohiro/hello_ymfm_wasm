// App-private output muting below the PCM release host. Hardware playback,
// authored pan/volume, and release envelopes keep advancing while inaudible.
export function createSynthPcmMuteTransport(raw) {
  if(['write','loadMemory','reset'].some(name=>typeof raw?.[name]!=='function'))throw TypeError('PCM mute needs a physical transport');
  const pans=new Uint8Array(8),muted=new Array(8).fill(false);
  let selected=0,control=0;
  function writePan(ch) {
    raw.write(7,(control&128)|64|ch);raw.write(1,muted[ch]?0:pans[ch]);
    // Selecting a channel must preserve both the original channel and the
    // RAM window/global-enable bits, even if RAM banking was selected last.
    if(!(control&64)&&selected!==ch)raw.write(7,(control&128)|64|selected);
    raw.write(7,control);
  }
  function write(register,value) {
    if(register===1){pans[selected]=value;raw.write(register,muted[selected]?0:value);return;}
    raw.write(register,value);
    if(register===7){control=value;if(value&64)selected=value&7;}
  }
  function reset() {
    raw.reset();pans.fill(0);selected=control=0;
    for(let ch=0;ch<8;ch++)if(muted[ch])writePan(ch);
  }
  function setChannelMuted(ch,value) {
    if(!Number.isInteger(ch)||ch<0||ch>7)throw RangeError('PCM mute channel must be 0..7');
    if(typeof value!=='boolean')throw TypeError('PCM muted must be a boolean');
    if(muted[ch]===value)return;
    muted[ch]=value;writePan(ch);
  }
  return {write,reset,loadMemory:(...args)=>raw.loadMemory(...args),setChannelMuted,
    dispose(){muted.fill(false);pans.fill(0);selected=control=0;},
    getState:()=>({selected,control,pans:[...pans],muted:[...muted]})};
}
