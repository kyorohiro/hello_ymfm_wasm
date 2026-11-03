/** Physical/manual voices exposed by the Playground Keyboard inspector path.
 * This table never creates a chip, initializes an instrument or changes audio.
 * @typedef {{id:string,label:string}} PlaygroundKeyboardChannel
 */
/** @param {string} kind
 * @param {{fds?:boolean,fdsEnabled?:boolean,model?:string,registers?:ArrayLike<number>,rhythmEnabled?:boolean,rhythmVoices?:boolean,effectiveFourOpMask?:number,newMode?:boolean}} [options]
 * @returns {PlaygroundKeyboardChannel[]} */
export function keyboardChannels(kind,{fds=true,fdsEnabled=fds,model,registers,rhythmEnabled,rhythmVoices=false,effectiveFourOpMask,newMode}={}) {
  const numbered=(prefix,count,label)=>Array.from({length:count},(_,index)=>({id:`${prefix}${index}`,label:`${label} ${index+1}`}));
  const native=labels=>labels.map((label,index)=>({id:String(index),label}));
  if(kind==='ym2612')return numbered('fm:',6,'FM');
  if(['ym2203','ym2608','ym2610','ym2610b'].includes(kind)){
    const fm=kind==='ym2203'?3:kind==='ym2610'&&model!=='ym2610b'?4:6;
    const channels=[...numbered('fm:',fm,'FM'),...numbered('ssg:',3,'SSG')];
    if(kind==='ym2608')channels.push(...['Bass drum','Snare','Cymbal','Hi-hat','Tom','Rim shot'].map((label,index)=>({id:`rhythm:${index}`,label:`Rhythm: ${label}`})));
    if(kind==='ym2610'||kind==='ym2610b')channels.push(...numbered('adpcm-a:',6,'ADPCM-A'));
    if(kind!=='ym2203')channels.push({id:'adpcm-b:0',label:'ADPCM-B'});
    return channels;
  }
  if(kind==='ay8910')return numbered('',3,'Tone / noise');
  if(kind==='pokey')return numbered('',4,'Tone / polynomial noise');
  if(kind==='segapsg')return native(['Tone 1','Tone 2','Tone 3','Noise']);
  if(kind==='gameboy')return native(['Pulse 1','Pulse 2','Wave','Noise']);
  if(kind==='nes')return native(['Pulse 1','Pulse 2','Triangle','Noise','DMC',...(fdsEnabled?['FDS']:[])]);
  if(kind==='scsp')return numbered('',32,'PCM slot');
  if(kind==='ps1')return numbered('',24,'ADPCM voice');
  if(kind==='snes')return numbered('',8,'Voice');
  if(kind==='ym2151')return numbered('',8,'FM');
  if(kind==='ym2413'){const rhythm=rhythmEnabled??!!((registers?.[0x0e]??0)&32);return [...numbered('',rhythm?6:9,'FM'),...(rhythm?['Bass drum','Snare','Tom','Cymbal','Hi-hat'].map((label,index)=>({id:`rhythm:${index}`,label:`Rhythm: ${label}`})):[])];}
  if(['ym3526','ym3812','y8950','ymf262'].includes(kind)){
    const pairs=[0,1,2,9,10,11],mask=effectiveFourOpMask??registers?.[0x104]??0,rhythm=rhythmEnabled??!!((registers?.[0xbd]??0)&32);
    return [...numbered('',kind==='ymf262'?18:9,'FM').filter(({id})=>{const ch=Number(id),pair=pairs.indexOf(ch-3);return !(kind==='ymf262'&&newMode===false&&ch>=9)&&!(kind==='ymf262'&&pair>=0&&(mask&(1<<pair)))&&!(rhythm&&ch>=6&&ch<=8);}),...(rhythm&&rhythmVoices?['Bass drum','Snare','Tom','Cymbal','Hi-hat'].map((label,index)=>({id:`rhythm:${index}`,label:`Rhythm: ${label}`})):[]),...(kind==='y8950'?[{id:'adpcm',label:'ADPCM sample'}]:[])];
  }
  if(kind==='wonderswan')return native(['Wave 1','Wave 2 / Voice PCM','Wave 3 / Sweep','Wave 4 / Noise']);
  if(kind==='huc6280')return numbered('',6,'Wave');
  if(kind==='rf5c164')return numbered('',8,'PCM');
  if(kind==='okim6258')return native(['ADPCM sample']);
  if(kind==='dx7')return native(['16 voices']);
  return [];
}

/** Playback constraints belong beside the selector, instead of inventing a
 * pitched voice for noise generators or streaming sample FIFOs.
 * @param {string} kind @param {string} [channel] */
export function keyboardChannelHint(kind,channel='0') {
  if(kind==='scsp')return 'Plays the selected physical SCSP slot with its PCM, tuning and envelope. An original waveform is ready after Prepare audio.';
  if(kind==='ps1')return 'Plays the selected physical SPU voice with its assigned ADPCM sample, tuning and envelope. A built-in original waveform is ready after Prepare audio.';
  if(kind==='pokey')return 'Plays the selected physical POKEY channel using its current distortion and volume. Joined pairs use the upper channel; shared clock and filter settings affect the chip.';
  if(kind==='ay8910')return 'Uses this channel’s tone/noise mixer and volume or shared envelope. Noise and envelope settings are shared by all three channels.';
  if(kind==='pwm')return 'PWM plays a timed sample stream and has no independent pitched Keyboard channel.';
  if(!keyboardChannels(kind).length)return 'This chip has no Keyboard voice adapter. Use keyboard.bind() to connect a custom instrument.';
  if(['ym2413','ym3526','ym3812','y8950','ymf262'].includes(kind)&&channel.startsWith('rhythm:'))return 'Triggers the configured hardware drum; MIDI pitch does not retune its shared physical channel.';
  if(kind==='rf5c164')return 'Uses this channel’s loaded PCM and volume/pan. C4 plays its configured sample speed; other keys transpose the playback rate.';
  if(kind==='okim6258'||kind==='y8950'&&channel==='adpcm'||/^rhythm:|^adpcm-a:|^adpcm-b:/.test(channel)||kind==='nes'&&channel==='4')return 'Triggers the configured sample at its current playback rate; MIDI pitch does not retune this sample voice.';
  if(kind==='segapsg'&&channel==='3'||kind==='gameboy'&&channel==='3'||kind==='nes'&&channel==='3')return 'Triggers the current noise settings; MIDI pitch does not retune the noise generator.';
  if(kind==='dx7')return 'Plays the selected six-operator voice with up to 16 allocated notes.';
  if(kind==='wonderswan')return 'Plays this channel’s current waveform. CH2 Voice PCM uses its current byte; CH3 retains Sweep and CH4 retains Noise settings.';
  if(kind==='huc6280'&&(channel==='4'||channel==='5'))return 'Uses the channel’s current waveform or noise settings. Noise playback keeps its configured rate.';
  return 'Plays this channel’s current instrument. Configure its voice or load a sample before using Keyboard.';
}
