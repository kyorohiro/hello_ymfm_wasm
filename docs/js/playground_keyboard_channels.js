/** Physical/manual voices exposed by the Playground Keyboard inspector path.
 * This table never creates a chip, initializes an instrument or changes audio.
 * @typedef {{id:string,label:string}} PlaygroundKeyboardChannel
 */
/** @param {string} kind
 * @param {{fds?:boolean,fdsEnabled?:boolean,model?:string}} [options]
 * @returns {PlaygroundKeyboardChannel[]} */
export function keyboardChannels(kind,{fds=true,fdsEnabled=fds,model}={}) {
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
  if(kind==='segapsg')return native(['Tone 1','Tone 2','Tone 3','Noise']);
  if(kind==='gameboy')return native(['Pulse 1','Pulse 2','Wave','Noise']);
  if(kind==='nes')return native(['Pulse 1','Pulse 2','Triangle','Noise','DMC',...(fdsEnabled?['FDS']:[])]);
  if(kind==='snes')return numbered('',8,'Voice');
  if(kind==='ym2151')return numbered('',8,'FM');
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
  if(kind==='pwm')return 'PWM plays a timed sample stream and has no independent pitched Keyboard channel.';
  if(!keyboardChannels(kind).length)return 'This chip has no Keyboard voice adapter. Use keyboard.bind() to connect a custom instrument.';
  if(kind==='rf5c164')return 'Uses this channel’s loaded PCM and volume/pan. C4 plays its configured sample speed; other keys transpose the playback rate.';
  if(kind==='okim6258'||/^rhythm:|^adpcm-a:|^adpcm-b:/.test(channel)||kind==='nes'&&channel==='4')return 'Triggers the configured sample at its current playback rate; MIDI pitch does not retune this sample voice.';
  if(kind==='segapsg'&&channel==='3'||kind==='gameboy'&&channel==='3'||kind==='nes'&&channel==='3')return 'Triggers the current noise settings; MIDI pitch does not retune the noise generator.';
  if(kind==='dx7')return 'Plays the selected six-operator voice with up to 16 allocated notes.';
  if(kind==='huc6280'&&(channel==='4'||channel==='5'))return 'Uses the channel’s current waveform or noise settings. Noise playback keeps its configured rate.';
  return 'Plays this channel’s current instrument. Configure its voice or load a sample before using Keyboard.';
}
