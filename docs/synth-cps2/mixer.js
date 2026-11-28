// SPDX-License-Identifier: BSD-3-Clause
export function defaultMix() {
  return {master:100,soundVolume:100,mutes:Array(19).fill(false),solos:Array(19).fill(false)};
}

export function validateMix(mix=defaultMix()) {
  const {master,soundVolume=100}=mix;
  if (![master,soundVolume].every(value=>Number.isInteger(value) && value>=0 && value<=480) ||
      ![mix.mutes,mix.solos].every(list=>Array.isArray(list) && list.length===19 && list.every(v=>typeof v==='boolean')))
    throw Error('Invalid CPS2 mixer settings.');
  return {master,soundVolume,mutes:[...mix.mutes],solos:[...mix.solos]};
}

export function mutedVoices({mutes,solos}) {
  const solo=solos.some(Boolean);
  return mutes.map((mute,i)=>mute || (solo && !solos[i]));
}

export function setupMixer(onChange) {
  let mix=defaultMix();
  const master=document.getElementById('mix-master'), level=document.getElementById('mix-level');
  const sound=document.getElementById('mix-sound'), soundLevel=document.getElementById('mix-sound-level');
  const buttons=[];
  for(let i=0;i<19;i++){
    const name=i<16?'CH'+(i+1):'ADPCM '+(i-15);
    const row=document.createElement('div'),label=document.createElement('strong');
    label.textContent=name;row.append(label);
    for(const [key,text] of [['mutes','Mute'],['solos','Solo']]){
      const button=document.createElement('button');
      button.textContent=text;button.setAttribute('aria-label',name+' '+text);
      button.onclick=()=>{mix[key][i]=!mix[key][i];render();onChange(mix);};
      buttons.push({button,key,i});row.append(button);
    }
    document.getElementById(i<16?'mix-pcm':'mix-adpcm').append(row);
  }
  function render(){
    sound.value=mix.soundVolume;soundLevel.value=mix.soundVolume+'%';
    master.value=mix.master;level.value=mix.master+'%';
    for(const {button,key,i} of buttons)button.setAttribute('aria-pressed',String(mix[key][i]));
  }
  sound.oninput=()=>{mix.soundVolume=Number(sound.value);render();onChange(mix);};
  master.oninput=()=>{mix.master=Number(master.value);render();onChange(mix);};
  render();
  return {get:()=>validateMix(mix),set(value){mix=validateMix(value);render();onChange(mix);}};
}
