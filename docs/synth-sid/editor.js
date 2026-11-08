// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';
import {createDefaultPreset,readPreset,filterModeBits,filterModeFromBits} from './preset.js';

// Imported oscillator-register ratios need not lie on the authoring step grid.
// Keep the actual Number intact; an abbreviated label explicitly says approx.
const ratioText=value=>{const display=Number(value.toPrecision(6));return display===value?String(value):`≈ ${display}`;};

/** Passive patch editor. It never creates or resumes an audio device. */
export function createEditor({root,onChange=()=>{},onError=()=>{}}) {
  const doc=root.ownerDocument, cleanups=[], controls=[], helpPanels=new Map();
  let preset=createDefaultPreset(), display=preset, observation=null, observing=false, disposed=false;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,event,handler,options)=>{node.addEventListener(event,handler,options);cleanups.push(()=>node.removeEventListener(event,handler,options));};
  const report=error=>{if(!disposed)onError(error);};
  function commit(change) {
    if(disposed)return;
    // Observations are display state, never an editable portable preset. This
    // guard also rejects synthetic input events on disabled live controls.
    if(observing){render();return;}
    try {const next=readPreset(preset);change(next);preset=readPreset(next);render();Promise.resolve(onChange(readPreset(preset))).catch(report);}
    catch(error){render();report(error);}
  }
  const pointerFocus=node=>listen(node,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur();}});
  function card(title,id,{wide=false,open=true}={}) {
    const node=make('details',`sid-card${wide?' sid-wide':''}`);node.id=id;node.open=open;
    const summary=make('summary',''),heading=make('span','',title),button=make('button','sid-help-button','?');
    button.type='button';button.id=`${id}HelpButton`;button.setAttribute('aria-label',`Help for ${title}`);
    button.setAttribute('aria-controls',`${id}HelpPanel`);button.setAttribute('aria-expanded','false');
    const content=make('div','sid-card-content'),panel=make('div','sid-help-panel');panel.id=`${id}HelpPanel`;panel.hidden=true;
    pointerFocus(button);listen(button,'keydown',event=>event.stopPropagation());
    listen(button,'click',event=>{event.preventDefault();event.stopPropagation();const show=!node.open||panel.hidden;panel.hidden=!show;if(show)node.open=true;button.setAttribute('aria-expanded',String(show));button.blur();});
    summary.append(heading,button);node.append(summary,content);root.append(node);helpPanels.set(content,panel);return content;
  }
  const fields=parent=>{const node=make('div','sid-fields');parent.append(node);return node;};
  const help=(parent,text)=>{const node=make('p','sid-help',text);(helpPanels.get(parent)??parent).append(node);return node;};
  // Preserve each node, fold and help disclosure across samples. Color marks
  // changes in place; it does not insert extra labels or move the controls.
  function markChanged(node,value){const next=String(value);node.dataset.changed=String(observing&&node.dataset.observedValue!==undefined&&node.dataset.observedValue!==next);node.dataset.observedValue=next;}
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
      if(observing){event.preventDefault();event.stopPropagation();return;}
      const current=buttons.findIndex(button=>button.dataset.value===get(preset));let next;
      if(['ArrowRight','ArrowDown'].includes(event.key))next=(current+1)%buttons.length;
      else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(current+buttons.length-1)%buttons.length;
      else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
      event.preventDefault();event.stopPropagation();commit(value=>set(value,buttons[next].dataset.value));buttons[next].focus();
    });
    controls.push(()=>{
      const rawWaves=observing&&observation&&id==='waveform';group.setAttribute('role',rawWaves?'group':'radiogroup');
      for(const button of buttons){
        const mask={triangle:16,saw:32,pulse:64,noise:128}[button.dataset.value];
        const active=rawWaves?Boolean(observation.waveformMask&mask):button.dataset.value===get(display);
        button.disabled=observing;button.tabIndex=observing?-1:active?0:-1;button.setAttribute('role',rawWaves?'button':'radio');
        if(rawWaves){button.removeAttribute('aria-checked');button.setAttribute('aria-pressed',String(active));}
        else{button.removeAttribute('aria-pressed');button.setAttribute('aria-checked',String(active));}
        markChanged(button,active);
      }
    });
  }
  function toggle(parent,label,id,get,set) {
    const row=make('label','sid-field sid-check'),input=make('input');input.type='checkbox';input.id=id;row.append(input,make('span','',label));parent.append(row);
    listen(input,'change',()=>{commit(next=>set(next,input.checked));input.blur();});
    controls.push(()=>{input.checked=Boolean(get(display));input.disabled=observing;markChanged(input,input.checked);});return input;
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
      controls.push(()=>{const active=observing&&observation?Boolean(observation.filter.modeMask&bit):preset.filter.enabled&&!!(filterModeBits(preset.filter.mode)&bit);button.setAttribute('aria-pressed',String(active));button.disabled=observing;markChanged(button,active);});
      group.append(button);
    }
  }
  function number(parent,label,id,min,max,step,get,set,{slider=false,enabled=()=>true,rangeStep=step,format=String}={}) {
    const row=field(parent,label,id,slider?'sid-slider':''),control=createParamControl({label,min,max,step,value:get(preset),showLabel:false,wheelAdjust:false,onChange:value=>commit(next=>set(next,value))});
    const [minus,value,plus]=control.element.children;value.id=id;value.setAttribute('role','spinbutton');value.setAttribute('aria-labelledby',`${id}Label`);value.setAttribute('aria-valuemin',String(min));value.setAttribute('aria-valuemax',String(max));
    for(const [button,delta] of [[minus,-1],[plus,1]]){button.dataset.stepperFor=id;button.dataset.stepperDelta=String(delta);button.setAttribute('aria-label',`${delta<0?'Decrease':'Increase'} ${label}`);pointerFocus(button);}
    pointerFocus(value);row.append(control.element);
    const keyAdjust=event=>{
      if(observing){event.preventDefault();event.stopPropagation();render();return;}
      const current=get(preset);let next;
      if(['ArrowRight','ArrowUp'].includes(event.key))next=current+step;else if(['ArrowLeft','ArrowDown'].includes(event.key))next=current-step;
      else if(event.key==='PageUp')next=current+step*10;else if(event.key==='PageDown')next=current-step*10;
      else if(event.key==='Home')next=min;else if(event.key==='End')next=max;else return;
      event.preventDefault();event.stopPropagation();commit(value=>set(value,Math.max(min,Math.min(max,next))));
    };
    listen(value,'keydown',keyAdjust);
    let range;
    if(slider){range=make('input');Object.assign(range,{id:`${id}Range`,type:'range',min:String(min),max:String(max),step:String(rangeStep)});range.setAttribute('aria-labelledby',`${id}Label`);row.append(range);listen(range,'input',()=>commit(next=>set(next,Number(range.value))));if(rangeStep==='any')listen(range,'keydown',keyAdjust);for(const event of ['pointerup','pointercancel','change'])listen(range,event,()=>range.blur());}
    controls.push(()=>{
      const current=get(display),finite=Number.isFinite(current),inRange=finite&&current>=min&&current<=max,active=observing||enabled(display);
      control.updateVisual(finite?current:0);value.textContent=finite?format(current):'—';value.title=finite?String(current):'Undefined: carrier frequency is zero';
      value.dataset.value=finite?String(current):'unavailable';markChanged(value,value.dataset.value);value.dataset.outOfRange=String(observing&&!inRange);
      value.setAttribute('aria-valuetext',finite?format(current):'Unavailable: carrier frequency is zero');
      if(finite){value.setAttribute('aria-valuenow',String(current));value.setAttribute('aria-valuemin',String(observing?Math.min(min,current):min));value.setAttribute('aria-valuemax',String(observing?Math.max(max,current):max));}
      else{value.removeAttribute('aria-valuenow');value.removeAttribute('aria-valuemin');value.removeAttribute('aria-valuemax');}
      value.disabled=observing||!active;minus.disabled=observing||!active||current<=min;plus.disabled=observing||!active||current>=max;row.dataset.disabled=String(!active);
      if(range){range.dataset.unavailable=String(observing&&!inRange);range.value=String(inRange?current:min);if(rangeStep==='any'){if(finite)range.setAttribute('aria-valuenow',String(current));else range.removeAttribute('aria-valuenow');}range.disabled=observing||!active;}
    });
  }

  const filter=card('Shared SID filter','filterCard'),filterFields=fields(filter);
  choice(filterFields,'SID model','sidModel',[['6581','6581'],['8580','8580 · Preview']],p=>p.model,(p,value)=>p.model=value);
  help(filter,'Compare the models with the same sound settings. Switching model stops held notes and resets Pitch.');
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
  const testHelp=help(voice,'Changing TEST stops held notes and resets Pitch. Leave it off for ordinary playing.');testHelp.id='testHelp';

  const modulation=card('Sync / Ring','modulationCard',{wide:true,open:false}),modFields=fields(modulation);
  toggle(modFields,'Hardware oscillator Sync','syncEnabled',p=>p.modulation.sync,(p,value)=>p.modulation.sync=value);
  toggle(modFields,'Hardware Ring modulation · Triangle only','ringEnabled',p=>p.modulation.ring,(p,value)=>p.modulation.ring=value);
  number(modFields,'Modulator ratio','modulationRatio',.125,8,.125,p=>p.modulation.ratio,(p,value)=>p.modulation.ratio=value,{slider:true,rangeStep:'any',format:ratioText});
  const modHelp=help(modulation,'');modHelp.id='modulationHelp';
  help(modulation,'Sync and Ring use real SID oscillator coupling. This synth assigns silent Triangle voice 3 to carrier voice 1. The ratio follows your note in software. Switching Sync or Ring stops held notes and resets Pitch.');
  for(const content of [filter,voice,modulation])content.append(helpPanels.get(content));

  function render() {
    if(disposed)return;
    // A raw observation deliberately bypasses readPreset: multiple/no waveform,
    // silent filter routing and a ratio outside the keyboard range are valid
    // hardware states even when they cannot become an authored instrument.
    display=observing&&observation?{
      model:observation.model,
      voice:{waveform:({16:'triangle',32:'saw',64:'pulse',128:'noise'})[observation.waveformMask]??'none',
        pulseWidth:observation.pulseWidth,attack:observation.attack,decay:observation.decay,
        sustain:observation.sustain,release:observation.release,test:observation.test},
      filter:{enabled:observation.filter.routed,mode:filterModeFromBits(observation.filter.modeMask),
        cutoff:observation.filter.cutoff,resonance:observation.filter.resonance,volume:observation.filter.volume},
      modulation:{sync:observation.sync,ring:observation.ring,ratio:observation.source.ratio},
    }:preset;
    root.dataset.observing=String(observing);root.dataset.observationVoice=observing&&observation?String(observation.voice):'';
    root.dataset.observationWaveformMask=observing&&observation?String(observation.waveformMask):'';
    for(const update of controls)update();
    const outputs=[[1,'LP'],[2,'BP'],[4,'HP']].filter(([bit])=>filterModeBits(display.filter.mode)&bit).map(([,label])=>label).join(' + ');
    if(observing&&observation){
      const o=observation;
      filterHelp.textContent=o.filter.routed
        ?`CH ${o.voice+1} is routed through the shared filter · ${outputs||'all outputs off (silent routing)'}.`
        :`CH ${o.voice+1} uses dry routing. Shared filter outputs: ${outputs||'all off'}.`;
      if(o.voice===2&&!o.filter.routed&&o.filter.voice3off)filterHelp.textContent+=' Hardware Voice 3 dry output is disabled.';
      modHelp.textContent=`Observed connection: CH ${o.source.voice+1} → CH ${o.voice+1}. `+
        (o.sync||o.ring?`Frequency-register ratio: ${o.source.ratio===null?'undefined (carrier frequency is zero)':ratioText(o.source.ratio)+'×'}.`:'Sync / Ring are off.');
      if(o.source.ratio!==null&&(o.source.ratio<.125||o.source.ratio>8))modHelp.textContent+=' This actual ratio is outside the keyboard tuning range; no substitute value is shown.';
      if(o.ring&&!(o.waveformMask&16))modHelp.textContent+=' Ring affects Triangle only.';
      modHelp.dataset.warning=String(o.ring&&!(o.waveformMask&16));
      testHelp.dataset.warning=String(o.test);testHelp.textContent=o.test?'Observed TEST is held: this oscillator is reset.':'Observed TEST is off.';
    }else{
      filterHelp.textContent=display.filter.enabled?`Filter on · ${outputs}${display.filter.mode==='notch'?' (Notch)':''} · shared cutoff and resonance for every sounding voice.`:'Filter bypassed · dry routing. Turn on LP, BP or HP to enable the filter automatically.';
      const paired=display.modulation.sync||display.modulation.ring;
      modHelp.textContent=paired?'One carrier + one silent modulator · maximum 1 note.':'Sync / Ring off · 3 independent voices with round robin.';
      if(display.modulation.ring&&display.voice.waveform!=='triangle'){modHelp.textContent+=' Ring affects Triangle only; select Triangle to hear it.';modHelp.dataset.warning='true';}else delete modHelp.dataset.warning;
      testHelp.dataset.warning=String(display.voice.test);testHelp.textContent=display.voice.test?'TEST is held: the oscillator is reset. Turn TEST off for ordinary playing.':'Changing TEST stops held notes and resets Pitch. Leave it off for ordinary playing.';
    }
  }
  render();
  return {
    update(value){if(disposed)return;preset=readPreset(value);render();},
    observe(value,{active=value!==null}={}){if(disposed)return;if(value!==null)observation=value;observing=Boolean(active);if(!observing)observation=null;render();},
    getPreset:()=>readPreset(preset),
    dispose(){if(disposed)return;disposed=true;for(const cleanup of cleanups)cleanup();},
  };
}
