// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';
import {createDefaultPreset,readPreset,filterModeBits,filterModeFromBits} from './preset.js';

/** Passive patch editor. It never creates or resumes an audio device. */
export function createEditor({root,onChange=()=>{},onError=()=>{}}) {
  const doc=root.ownerDocument, cleanups=[], controls=[];
  let preset=createDefaultPreset(), disposed=false;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,event,handler,options)=>{node.addEventListener(event,handler,options);cleanups.push(()=>node.removeEventListener(event,handler,options));};
  const report=error=>{if(!disposed)onError(error);};
  function commit(change) {
    if(disposed)return;
    try {const next=readPreset(preset);change(next);preset=readPreset(next);render();Promise.resolve(onChange(readPreset(preset))).catch(report);}
    catch(error){render();report(error);}
  }
  const pointerFocus=node=>listen(node,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur();}});
  function card(title,id,{wide=false,open=true}={}) {
    const node=make('details',`sid-card${wide?' sid-wide':''}`);node.id=id;node.open=open;
    node.append(make('summary','',title));const content=make('div','sid-card-content');node.append(content);root.append(node);return content;
  }
  const fields=parent=>{const node=make('div','sid-fields');parent.append(node);return node;};
  const help=(parent,text)=>{const node=make('p','sid-help',text);parent.append(node);return node;};
  function field(parent,label,id,className='') {
    const node=make('div',`sid-field ${className}`),title=make('span','',label);title.id=`${id}Label`;node.append(title);parent.append(node);return node;
  }
  function choice(parent,label,id,choices,get,set) {
    const row=field(parent,label,id,'sid-choice-field'),group=make('div','sid-choice-group');group.id=id;group.setAttribute('role','radiogroup');group.setAttribute('aria-labelledby',`${id}Label`);row.append(group);
    const buttons=choices.map(([value,text])=>{
      const button=make('button','',text);button.type='button';button.dataset.choiceFor=id;button.dataset.value=value;button.setAttribute('role','radio');pointerFocus(button);
      listen(button,'click',()=>commit(next=>set(next,value)));group.append(button);return button;
    });
    listen(group,'keydown',event=>{
      const current=buttons.findIndex(button=>button.dataset.value===get(preset));let next;
      if(['ArrowRight','ArrowDown'].includes(event.key))next=(current+1)%buttons.length;
      else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(current+buttons.length-1)%buttons.length;
      else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
      event.preventDefault();event.stopPropagation();commit(value=>set(value,buttons[next].dataset.value));buttons[next].focus();
    });
    controls.push(()=>buttons.forEach(button=>{const active=button.dataset.value===get(preset);button.setAttribute('aria-checked',String(active));button.tabIndex=active?0:-1;}));
  }
  function toggle(parent,label,id,get,set) {
    const row=make('label','sid-field sid-check'),input=make('input');input.type='checkbox';input.id=id;row.append(input,make('span','',label));parent.append(row);
    listen(input,'change',()=>{commit(next=>set(next,input.checked));input.blur();});
    controls.push(()=>{input.checked=Boolean(get(preset));});return input;
  }
  function filterOutputs(parent) {
    const row=field(parent,'Filter outputs · combine','filterMode','sid-choice-field'),group=make('div','sid-choice-group');
    group.id='filterMode';group.setAttribute('role','group');group.setAttribute('aria-labelledby','filterModeLabel');row.append(group);
    for(const [bit,id,label]of [[1,'filterLowpass','LP · Low-pass'],[2,'filterBandpass','BP · Band-pass'],[4,'filterHighpass','HP · High-pass']]){
      const button=make('button','',label);button.id=id;button.type='button';button.dataset.filterBit=String(bit);pointerFocus(button);
      listen(button,'click',()=>commit(next=>{
        const bits=(next.filter.enabled?filterModeBits(next.filter.mode):0)^bit;
        next.filter.mode=filterModeFromBits(bits);next.filter.enabled=bits!==0;
      }));
      controls.push(()=>button.setAttribute('aria-pressed',String(preset.filter.enabled&&!!(filterModeBits(preset.filter.mode)&bit))));
      group.append(button);
    }
  }
  function number(parent,label,id,min,max,step,get,set,{slider=false,enabled=()=>true}={}) {
    const row=field(parent,label,id,slider?'sid-slider':''),control=createParamControl({label,min,max,step,value:get(preset),showLabel:false,wheelAdjust:false,onChange:value=>commit(next=>set(next,value))});
    const [minus,value,plus]=control.element.children;value.id=id;value.setAttribute('role','spinbutton');value.setAttribute('aria-labelledby',`${id}Label`);value.setAttribute('aria-valuemin',String(min));value.setAttribute('aria-valuemax',String(max));
    for(const [button,delta] of [[minus,-1],[plus,1]]){button.dataset.stepperFor=id;button.dataset.stepperDelta=String(delta);button.setAttribute('aria-label',`${delta<0?'Decrease':'Increase'} ${label}`);pointerFocus(button);}
    pointerFocus(value);row.append(control.element);
    listen(value,'keydown',event=>{
      const current=get(preset);let next;
      if(['ArrowRight','ArrowUp'].includes(event.key))next=current+step;else if(['ArrowLeft','ArrowDown'].includes(event.key))next=current-step;
      else if(event.key==='PageUp')next=current+step*10;else if(event.key==='PageDown')next=current-step*10;
      else if(event.key==='Home')next=min;else if(event.key==='End')next=max;else return;
      event.preventDefault();event.stopPropagation();commit(value=>set(value,Math.max(min,Math.min(max,next))));
    });
    let range;
    if(slider){range=make('input');Object.assign(range,{id:`${id}Range`,type:'range',min:String(min),max:String(max),step:String(step)});range.setAttribute('aria-labelledby',`${id}Label`);row.append(range);listen(range,'input',()=>commit(next=>set(next,Number(range.value))));for(const event of ['pointerup','pointercancel','change'])listen(range,event,()=>range.blur());}
    controls.push(()=>{const current=get(preset),active=enabled(preset);control.updateVisual(current);value.setAttribute('aria-valuenow',String(current));value.disabled=!active;minus.disabled=!active||current<=min;plus.disabled=!active||current>=max;row.dataset.disabled=String(!active);if(range){range.value=String(current);range.disabled=!active;}});
  }

  const filter=card('Shared SID filter','filterCard'),filterFields=fields(filter);
  toggle(filterFields,'Enable filter','filterEnabled',p=>p.filter.enabled,(p,value)=>{p.filter.enabled=value;if(value&&p.filter.mode==='off')p.filter.mode='lowpass';});
  filterOutputs(filterFields);
  number(filterFields,'Cutoff · hardware code','filterCutoff',0,2047,1,p=>p.filter.cutoff,(p,value)=>p.filter.cutoff=value,{slider:true});
  number(filterFields,'Resonance','filterResonance',0,15,1,p=>p.filter.resonance,(p,value)=>p.filter.resonance=value,{slider:true});
  number(filterFields,'Chip volume · 0–15','chipVolume',0,15,1,p=>p.filter.volume,(p,value)=>p.filter.volume=value);
  const filterHelp=help(filter,'');filterHelp.id='filterHelp';
  help(filter,'One shared hardware filter: selected LP, BP and HP outputs are added together with a common Cutoff and Resonance. LP + HP is Notch. With all outputs off, this synth bypasses the filter. Cutoff is a chip code, not Hz.');

  const voice=card('Sound source · SID oscillator','voiceCard'),voiceFields=fields(voice);
  choice(voiceFields,'Waveform','waveform',[['triangle','Triangle'],['saw','Saw'],['pulse','Pulse'],['noise','Noise']],p=>p.voice.waveform,(p,value)=>p.voice.waveform=value);
  number(voiceFields,'Pulse width · 0–4095','pulseWidth',0,4095,1,p=>p.voice.pulseWidth,(p,value)=>p.voice.pulseWidth=value,{slider:true,enabled:p=>p.voice.waveform==='pulse'});
  const envelope=fields(voice);
  for(const [key,label]of [['attack','Attack'],['decay','Decay'],['sustain','Sustain'],['release','Release']])number(envelope,`${label} · 0–15`,key,0,15,1,p=>p.voice[key],(p,value)=>p.voice[key]=value);
  help(voice,'ADSR uses hardware codes. Gate release follows the selected Release. Noise is a SID oscillator waveform, not a recorded sample.');
  const advanced=make('details','sid-advanced');advanced.append(make('summary','','Advanced · oscillator TEST'));voice.append(advanced);
  toggle(advanced,'Hold TEST · reset oscillator','oscillatorTest',p=>p.voice.test,(p,value)=>p.voice.test=value);
  const testHelp=help(advanced,'Changing TEST stops held notes and resets Pitch. Leave it off for ordinary playing.');testHelp.id='testHelp';

  const modulation=card('Sync / Ring · voice 3 → voice 1','modulationCard',{wide:true,open:false}),modFields=fields(modulation);
  toggle(modFields,'Hardware oscillator Sync','syncEnabled',p=>p.modulation.sync,(p,value)=>p.modulation.sync=value);
  toggle(modFields,'Hardware Ring modulation · Triangle only','ringEnabled',p=>p.modulation.ring,(p,value)=>p.modulation.ring=value);
  number(modFields,'Modulator ratio · software','modulationRatio',.125,8,.125,p=>p.modulation.ratio,(p,value)=>p.modulation.ratio=value,{slider:true});
  const modHelp=help(modulation,'');modHelp.id='modulationHelp';
  help(modulation,'Sync and Ring use real SID oscillator coupling. This synth assigns silent Triangle voice 3 to carrier voice 1. The ratio follows your note in software. Switching Sync or Ring stops held notes and resets Pitch.');

  function render() {
    if(disposed)return;for(const update of controls)update();
    const outputs=[[1,'LP'],[2,'BP'],[4,'HP']].filter(([bit])=>filterModeBits(preset.filter.mode)&bit).map(([,label])=>label).join(' + ');
    filterHelp.textContent=preset.filter.enabled?`Filter on · ${outputs}${preset.filter.mode==='notch'?' (Notch)':''} · shared cutoff and resonance for every sounding voice.`:'Filter bypassed · dry routing. Turn on LP, BP or HP to enable the filter automatically.';
    const paired=preset.modulation.sync||preset.modulation.ring;
    modHelp.textContent=paired?'One carrier + one silent modulator · maximum 1 note.':'Sync / Ring off · 3 independent voices with round robin.';
    if(preset.modulation.ring&&preset.voice.waveform!=='triangle'){modHelp.textContent+=' Ring affects Triangle only; select Triangle to hear it.';modHelp.dataset.warning='true';}else delete modHelp.dataset.warning;
    testHelp.dataset.warning=String(preset.voice.test);testHelp.textContent=preset.voice.test?'TEST is held: the oscillator is reset. Turn TEST off for ordinary playing.':'Changing TEST stops held notes and resets Pitch. Leave it off for ordinary playing.';
  }
  render();
  return {update(value){if(disposed)return;preset=readPreset(value);render();},getPreset:()=>readPreset(preset),dispose(){if(disposed)return;disposed=true;for(const cleanup of cleanups)cleanup();}};
}
