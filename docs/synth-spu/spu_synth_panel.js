// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {readMorph, morphPcm, morphShape, morphShapeName, MORPH_SHAPES} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';
import {createPlaygroundPs1VoicePanel} from '../playground/playground_ps1_voice_panel.js?v=ps1-deferred-release-1';

/** Reuse the PCM/ADSR/FX editors with one instrument for all keyboard voices.
 * Physical-channel inspection and audition controls belong to Playground. */
export function createSpuInstrumentPanel({root, invoke, ...options}) {
  let selectedMorphEndpoint='a',morphUiState=null;
  const panel = createPlaygroundPs1VoicePanel({root, ...options, invoke(method, args = []) {
    if (method === 'setPreset' || method === 'setChannel') return invoke('setInstrumentPreset', args.slice(1));
    if (method === 'setEnvelope') return invoke('setInstrumentEnvelope', args.slice(1));
    if (method === 'setWaveform') return morphDraft.enabled ? changeMorph({[selectedMorphEndpoint]:args[1]}) : invoke('setInstrumentWaveform', args.slice(1));
    if (method === 'setReverb' && Object.hasOwn(args[0] ?? {}, 'preset')) return invoke('setInstrumentReverbPreset', args);
    return invoke(method, args);
  }});
  root.querySelector('.chip-channel-list')?.remove();
  root.querySelector('.chip-editor-body > .chip-section')?.remove();
  root.querySelector('.chip-advanced')?.remove();
  for (const node of [...root.children]) if (node.tagName === 'P' && !node.classList.contains('chip-editor-status')) node.remove();
  const label = root.querySelector('[data-chip-control="ps1-reverb-send"]')?.closest('label')?.querySelector('.chip-field-label');
  if (label) label.textContent = 'Enable reverb';
  for (const node of root.querySelectorAll('p')) {
    if (node.textContent.startsWith('One cycle uses')) node.textContent = 'Draw a 112-sample PCM cycle or choose a shape. All notes use the same instrument. The cycle is encoded as four SPU ADPCM packets; quantization changes the resulting sound. Use Load audio for recordings and longer samples.';
    else if (node.textContent.startsWith('The graph shows')) node.textContent = 'The graph shows envelope shape, not measured timing. With Apply edits on, ADSR changes update every sounding note at its current level and sample position. Attack changes affect an active attack or the next note. With it off, each running note keeps its ADSR until the next Note On. Release rates 27–31 hold indefinitely; use Stop all sound for immediate silence. PCM edits update the common cycle and can restart held notes when Apply edits is on.';
    else if (node.textContent.startsWith('Choose a reverb preset')) node.textContent = 'Choosing a preset enables reverb; Off disables it. Uncheck Enable reverb to bypass it while keeping the preset. Return levels control the shared SPU effect. These are the core’s named reverb approximations.';
  }
  const envelopeEditor = root.querySelector('.chip-envelope-editor');
  const sections = [...root.querySelectorAll('.chip-editor-body > .chip-section')];
  const sectionNames = ['pcm', 'adsr', 'fx'];
  sections.forEach((section, index) => {
    const name = sectionNames[index];
    section.id = `instrumentPanel-${name}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', `instrumentTab-${name}`);
    section.hidden = index !== 0;
  });
  const sampleEditors=[...sections[0].children];
  const morph=root.ownerDocument.createElement('fieldset');morph.className='spu-morph';
  const shapeOptions=MORPH_SHAPES.map(shape=>`<option value="${shape}">${shape[0].toUpperCase()+shape.slice(1)}</option>`).join('');
  morph.innerHTML=`<legend>Software morph</legend>
    <label><input type="checkbox" data-morph="enabled"> Enable software morph</label>
    <div class="morph-editing" hidden>
      <div class="morph-targets" role="group" aria-label="Morph edit target">
        ${['a','b'].map(key=>`<button type="button" data-morph-edit="${key}" aria-pressed="${key==='a'}">Wave ${key.toUpperCase()} · Edit</button>`).join('')}
        <span class="morph-result-label">Result · blended PCM</span>
      </div>
      <div data-morph-editor-mount></div>
    </div>
    <div class="morph-endpoints">${['a','b'].map(key=>`<div><label>Wave ${key.toUpperCase()} <select data-morph="${key}" aria-label="Morph wave ${key.toUpperCase()}">${shapeOptions}<option value="custom" disabled>Custom PCM</option></select></label><button type="button" data-morph-capture="${key}">Use current PCM as ${key.toUpperCase()}</button></div>`).join('')}</div>
    <label class="morph-amount">Morph · A → B <input type="range" data-morph="amount" min="0" max="1" step="0.01" value="0" aria-label="Software morph amount"><output data-morph-output></output></label>
    <p class="subtext">Software feature: Tetorica blends two PCM cycles and writes the result into SPU sample memory. This is not a built-in PS1 SPU effect. The SPU plays the resulting ADPCM waveform.</p>
    <p class="subtext">112-sample cycles only. Enabling replaces the active PCM/audio sample. Drag Morph to change sounding notes without retriggering. A, B and Result share one canvas. Choose Wave A or Wave B to draw that waveform on the same canvas, or edit individual samples. Turning Morph off keeps the current blend; loading audio turns it off.</p>`;
  const editorNodes=sampleEditors.map(node=>{
    const anchor=root.ownerDocument.createComment('PCM editor position');node.before(anchor);return {node,anchor};
  });
  sections[0].insertBefore(morph,sampleEditors[0]);sampleEditors.push(morph);
  const morphControls=Object.fromEntries([...morph.querySelectorAll('[data-morph]')].map(node=>[node.dataset.morph,node]));
  let lastMorph=readMorph(),morphDraft=readMorph(),morphInFlight=0,currentPcm=null;
  const pcmCanvas=sections[0].querySelector('[data-chip-control="ps1-waveform"]');
  const pcmHeading=sections[0].querySelector('h3'),pcmHeadingText=pcmHeading.textContent;
  const pcmCanvasLabel=pcmCanvas.getAttribute('aria-label');
  let morphStroke=null;
  const morphListeners=[];
  function syncPcmEditor() {
    if(!morphUiState)return;
    const editing=morphDraft.enabled;
    if(morphStroke && (!editing || morphUiState.noise?.enabled || morphStroke.key!==selectedMorphEndpoint || morphStroke.identity!==JSON.stringify(morphDraft[selectedMorphEndpoint])))cancelMorphStroke();
    const mount=morph.querySelector('[data-morph-editor-mount]');
    for(const {node,anchor} of editorNodes) {
      if(editing){if(node.parentNode!==mount)mount.append(node);}
      else if(node.parentNode!==anchor.parentNode)anchor.after(node);
    }
    const displayState=editing ? {...morphUiState,channels:morphUiState.channels.map((voice,i)=>i===0 ? {...voice,waveform:{sample:voice.sample,pcm:morphDraft[selectedMorphEndpoint]}} : voice)} : morphUiState;
    panel.update(displayState);
    pcmHeading.textContent=editing ? `Wave ${selectedMorphEndpoint.toUpperCase()} · PCM editor` : pcmHeadingText;
    pcmCanvas.setAttribute('aria-label',editing ? `Edit Morph wave ${selectedMorphEndpoint.toUpperCase()}, 112 signed PCM samples. Drag to draw.` : pcmCanvasLabel);
    const info=root.querySelector('[data-chip-output="ps1-wave-info"]');
    if(editing&&info)info.textContent=`Editing Wave ${selectedMorphEndpoint.toUpperCase()} · A (blue), B (pink), Result (gold). Draw on this canvas or set individual samples. A completed stroke updates the blend without retriggering notes.`;
    if(editing)drawMorphCanvas();
  }
  function drawMorphCanvas() {
    if(!morphDraft.enabled)return;
    const settings=morphStroke ? {...morphDraft,[morphStroke.key]:morphStroke.pcm} : morphDraft;
    const ctx=pcmCanvas.getContext('2d');if(!ctx)return;
    const {width:w,height:h}=pcmCanvas,y=value=>(1-value)*h/2;
    ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#34444e';ctx.lineWidth=1;
    for(const value of [-1,0,1]){ctx.beginPath();ctx.moveTo(0,y(value));ctx.lineTo(w,y(value));ctx.stroke();}
    const waves={a:settings.a,b:settings.b,result:morphPcm(settings)},colors={a:'#7bbcf7',b:'#ef9ac2',result:'#e8b956'};
    // The selected source is drawn last and thicker, including when the
    // result exactly overlaps A or B at an endpoint.
    for(const key of ['result',selectedMorphEndpoint==='a'?'b':'a',selectedMorphEndpoint]) {
      ctx.strokeStyle=colors[key];ctx.lineWidth=key===selectedMorphEndpoint?3:1.5;
      ctx.setLineDash(key==='result'?[8,4]:[]);ctx.globalAlpha=key===selectedMorphEndpoint?1:.8;ctx.beginPath();
      waves[key].forEach((value,i)=>{const x=i*w/111;if(i)ctx.lineTo(x,y(value));else ctx.moveTo(x,y(value));});ctx.stroke();
    }
    ctx.setLineDash([]);ctx.globalAlpha=1;
  }
  function cancelMorphStroke() {
    if(!morphStroke)return;
    const {pointerId}=morphStroke;morphStroke=null;
    if(pcmCanvas.hasPointerCapture?.(pointerId))pcmCanvas.releasePointerCapture(pointerId);
    drawMorphCanvas();
  }
  function drawMorphPoint(event) {
    if(!morphStroke)return;
    const rect=pcmCanvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const index=Math.max(0,Math.min(111,Math.floor((event.clientX-rect.left)/rect.width*112)));
    const value=Math.max(-1,Math.min(1,1-2*(event.clientY-rect.top)/rect.height));
    const from=morphStroke.lastIndex??index,previous=morphStroke.lastValue??value;
    for(let i=Math.min(from,index);i<=Math.max(from,index);i++)morphStroke.pcm[i]=from===index?value:previous+(value-previous)*(i-from)/(index-from);
    morphStroke.lastIndex=index;morphStroke.lastValue=value;drawMorphCanvas();
  }
  function listenMorph(target,type,handler,options) {
    target.addEventListener(type,handler,options);morphListeners.push(()=>target.removeEventListener(type,handler,options));
  }
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])listenMorph(pcmCanvas,type,event=>{
    if(!morphDraft.enabled)return;
    event.stopImmediatePropagation();
    if(type==='pointercancel'||type==='lostpointercapture'){if(morphStroke?.pointerId===event.pointerId)cancelMorphStroke();return;}
    if(type==='pointerdown') {
      if(morphStroke||event.button!==0||!visible||activeSection!=='pcm'||morphUiState?.noise?.enabled)return;
      event.preventDefault();
      morphStroke={pointerId:event.pointerId,key:selectedMorphEndpoint,identity:JSON.stringify(morphDraft[selectedMorphEndpoint]),pcm:morphDraft[selectedMorphEndpoint].slice()};
      pcmCanvas.setPointerCapture(event.pointerId);drawMorphPoint(event);
    } else if(morphStroke?.pointerId===event.pointerId) {
      event.preventDefault();drawMorphPoint(event);
      if(type==='pointerup') {
        const stroke=morphStroke;morphStroke=null;
        if(pcmCanvas.hasPointerCapture(event.pointerId))pcmCanvas.releasePointerCapture(event.pointerId);
        void changeMorph({[stroke.key]:stroke.pcm});
      }
    }
  },true);
  listenMorph(root.ownerDocument.defaultView,'blur',()=>{cancelMorphStroke();drawMorphCanvas();});
  listenMorph(root.ownerDocument,'visibilitychange',()=>{if(root.ownerDocument.hidden)cancelMorphStroke();drawMorphCanvas();});
  for(const button of morph.querySelectorAll('[data-morph-edit]'))button.addEventListener('click',()=>{
    if(selectedMorphEndpoint===button.dataset.morphEdit)return;
    // Cancel an unfinished stroke before switching its destination; selection
    // only changes the editor and never writes the shared instrument.
    cancelMorphStroke();panel.setVisible(false);selectedMorphEndpoint=button.dataset.morphEdit;
    displayMorph();panel.setVisible(visible&&activeSection!=='audio');drawMorphCanvas();
  });
  function displayMorph() {
    morphControls.enabled.checked=morphDraft.enabled;
    morph.querySelector('.morph-editing').hidden=!morphDraft.enabled;
    for(const key of ['a','b']) {
      const button=morph.querySelector(`[data-morph-edit="${key}"]`);
      button.setAttribute('aria-pressed',String(selectedMorphEndpoint===key));
      morphControls[key].closest('.morph-endpoints>div').hidden=morphDraft.enabled&&selectedMorphEndpoint!==key;
    }
    for(const key of ['a','b'])morphControls[key].value=morphShapeName(morphDraft[key]);
    if(morphControls.amount!==root.ownerDocument.activeElement)morphControls.amount.value=String(morphDraft.amount);
    morphControls.amount.disabled=!morphDraft.enabled;
    morph.querySelector('[data-morph-output]').textContent=`A ${Math.round((1-Number(morphControls.amount.value))*100)}% / B ${Math.round(Number(morphControls.amount.value)*100)}%`;
    for(const button of morph.querySelectorAll('[data-morph-capture]'))button.disabled=!currentPcm;
    syncPcmEditor();
  }
  async function changeMorph(patch) {
    morphDraft=readMorph({...morphDraft,...patch});displayMorph();morphInFlight++;
    try {await invoke('setInstrumentMorph',[morphDraft]);}
    catch(error){options.onError?.(error);}
    finally {if(--morphInFlight===0){morphDraft=readMorph(lastMorph);displayMorph();}}
  }
  morphControls.enabled.addEventListener('change',()=>void changeMorph({enabled:morphControls.enabled.checked}));
  morphControls.amount.addEventListener('input',()=>void changeMorph({amount:Number(morphControls.amount.value)}));
  for(const key of ['a','b']) {
    morphControls[key].addEventListener('change',()=>void changeMorph({[key]:morphShape(morphControls[key].value)}));
    morph.querySelector(`[data-morph-capture="${key}"]`).addEventListener('click',()=>{if(currentPcm)void changeMorph({[key]:currentPcm.slice()});});
  }
  const source=root.ownerDocument.createElement('fieldset');source.className='spu-source';
  source.innerHTML=`<legend>Sound source</legend>
    <label>Source <select data-noise="source" aria-label="Sound source"><option value="sample">Sample · PCM / audio</option><option value="noise">SPU Noise</option></select></label>
    <div class="noise-clock" hidden><label>Noise clock <input type="range" data-noise="clock" min="0" max="63" step="1" value="48" aria-label="Shared Noise clock"><output data-noise-output="clock"></output></label></div>
    <p class="subtext" data-noise-info hidden>Noise clock is shared by all 24 voices. Keys trigger the ADSR envelope, not a musical pitch. Use ADSR to shape drums and effects. Your PCM/audio sample is kept. Noise and PMON switch each other off.</p>
    <p class="subtext">Changing Source stops current notes.</p>`;
  sections[0].prepend(source);
  const sourceSelect=source.querySelector('[data-noise="source"]'),noiseClock=source.querySelector('[data-noise="clock"]');
  const displayNoise=()=>{source.querySelector('[data-noise-output="clock"]').textContent=`${noiseClock.value} · Shift ${Number(noiseClock.value)>>2} / Step ${Number(noiseClock.value)&3}`;};
  let lastNoise=readNoise(),noisePending=0;
  async function changeNoise() {
    const revision=++noisePending;
    try {await invoke('setInstrumentNoise',[readNoise({enabled:sourceSelect.value==='noise',clock:Number(noiseClock.value)})]);}
    catch(error) {
      if(revision===noisePending){sourceSelect.value=lastNoise.enabled?'noise':'sample';noiseClock.value=String(lastNoise.clock);displayNoise();}
      options.onError?.(error);
    }
  }
  sourceSelect.addEventListener('change',changeNoise);
  // Range input fires throughout a drag; change only fires on release.
  noiseClock.addEventListener('input',()=>{displayNoise();void changeNoise();});
  const pmon = root.ownerDocument.createElement('fieldset');
  pmon.className = 'spu-pmon';
  pmon.innerHTML = `<legend>Pitch Modulation</legend>
    <label class="pmon-enable"><input type="checkbox" data-pmon="enabled"> Enable PMON</label>
    <div class="pmon-fields">
      <label>Modulator <select data-pmon="waveform" aria-label="Modulator waveform"><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="saw">Saw</option><option value="square">Square</option></select></label>
      <label>Ratio <input type="number" data-pmon="ratio" min="0.01" max="16" step="0.01" value="1" aria-label="Modulator frequency ratio"></label>
      <div class="pmon-ratios" aria-label="Ratio presets">${[.5,1,2,3].map(value => `<button type="button" data-pmon-ratio="${value}">${value}×</button>`).join('')}</div>
      <label>Depth <input type="range" data-pmon="depth" min="0" max="1" step="0.01" value="0.5" aria-label="Modulation depth"><output data-pmon-output="depth">50%</output></label>
      <label>Decay <input type="range" data-pmon="decayMs" min="0" max="5000" step="10" value="500" aria-label="Modulator decay"><output data-pmon-output="decayMs">≈ 500 ms</output></label>
    </div>
    <p class="subtext">A silent waveform modulates each note. Waveform, Ratio and Depth update sounding notes. Decay applies to new notes; zero holds the modulation. High ratios are limited by the SPU pitch range.</p>
    <p class="subtext">PMON uses two voices per note: 12 notes total. Switching On or Off stops current notes.</p>`;
  sections[2].classList.add('spu-fx');
  sections[2].append(pmon);
  const controls = Object.fromEntries([...pmon.querySelectorAll('[data-pmon]')].map(node => [node.dataset.pmon,node]));
  const displayPmon = () => {
    pmon.querySelector('[data-pmon-output="depth"]').textContent = `${Math.round(Number(controls.depth.value)*100)}%`;
    pmon.querySelector('[data-pmon-output="decayMs"]').textContent = Number(controls.decayMs.value) ? `≈ ${controls.decayMs.value} ms` : 'Hold';
  };
  let pmonPending = 0, lastPmon=readPmon();
  async function changePmon() {
    const revision = ++pmonPending;
    try {
      const value = readPmon({enabled:controls.enabled.checked,waveform:controls.waveform.value,ratio:Number(controls.ratio.value),depth:Number(controls.depth.value),decayMs:Number(controls.decayMs.value)});
      await invoke('setInstrumentPmon',[value]);
    } catch(error) {
      if (revision === pmonPending) for(const [key,node] of Object.entries(controls)) {
        if(key==='enabled')node.checked=lastPmon.enabled;else node.value=String(lastPmon[key]);
      }
      options.onError?.(error);
    } finally {if (revision === pmonPending) displayPmon();}
  }
  for (const node of Object.values(controls)) {
    node.addEventListener('input',displayPmon);
    node.addEventListener('change',changePmon);
  }
  for (const button of pmon.querySelectorAll('[data-pmon-ratio]')) button.addEventListener('click',() => {controls.ratio.value=button.dataset.pmonRatio; void changePmon();});
  let activeSection = 'pcm', visible = true;
  return {...panel, setSection(name) {
    if (![...sectionNames, 'audio'].includes(name)) throw new RangeError('Unknown SPU instrument section');
    if (name === activeSection) return;
    // Cancel a drawing/ADSR gesture before hiding its controls. Keyboard note
    // ownership belongs to the standalone controller and is unaffected.
    cancelMorphStroke();panel.setVisible(false);
    activeSection = name;
    root.hidden = name === 'audio';
    sections.forEach((section, index) => {section.hidden = sectionNames[index] !== name;});
    panel.setVisible(visible && name !== 'audio');
    if(visible&&name==='pcm')drawMorphCanvas();
  }, setVisible(value) {
    visible = Boolean(value);
    if(!visible)cancelMorphStroke();
    panel.setVisible(visible && activeSection !== 'audio');
    if(visible&&activeSection==='pcm')drawMorphCanvas();
  }, dispose() {cancelMorphStroke();for(const remove of morphListeners)remove();panel.dispose();}, update(state) {
    morphUiState=state;
    lastMorph=readMorph(state.morph);
    currentPcm=state.channels?.[0]?.waveform?.pcm??null;
    if(!morphInFlight){morphDraft=readMorph(lastMorph);displayMorph();}
    lastNoise=readNoise(state.noise);
    for(const node of sampleEditors)node.hidden=lastNoise.enabled;
    source.querySelector('.noise-clock').hidden=!lastNoise.enabled;
    source.querySelector('[data-noise-info]').hidden=!lastNoise.enabled;
    if(sourceSelect!==root.ownerDocument.activeElement)sourceSelect.value=lastNoise.enabled?'noise':'sample';
    if(noiseClock!==root.ownerDocument.activeElement)noiseClock.value=String(lastNoise.clock);
    displayNoise();
    syncPcmEditor();
    const settings=readPmon(state.pmon); lastPmon=settings;
    for (const [key,node] of Object.entries(controls)) {
      if (node === root.ownerDocument.activeElement) continue;
      if (key === 'enabled') node.checked=settings.enabled; else node.value=String(settings[key]);
    }
    displayPmon();
    for (const node of envelopeEditor?.querySelectorAll('[data-chip-envelope-handle]') ?? []) {
      for (const attr of ['aria-label', 'title']) node.setAttribute(attr, (node.getAttribute(attr) ?? '').replace(/^Voice 1 · /, ''));
    }
    const waveInfo = root.querySelector('[data-chip-output="ps1-wave-info"]');
    if (waveInfo) waveInfo.textContent = waveInfo.textContent.replace('for this voice', 'for this instrument');
  }};
}
