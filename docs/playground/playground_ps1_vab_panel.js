// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {MAX_VAB_FILE_BYTES, readVab, prepareVabTone} from './playground_ps1_vab.js';

/** Opening a bank is local-only; loading a Tone is one inspector transaction. */
export function createPlaygroundPs1VabPanel({root, getContext, invoke, onError=()=>{}}) {
  const doc=root.ownerDocument, listeners=[];
  let bank=null, name='', sequence=0, busy=false, disposed=false;
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  root.appendChild(make('h4','Import VAB sound bank'));
  const actions=make('div');actions.className='chip-actions';root.appendChild(actions);
  const open=make('button','Open VAB / VH + VB…');open.type='button';open.dataset.chipAction='ps1-vab-open';actions.appendChild(open);
  const file=make('input');file.type='file';file.accept='.vab,.vh,.vb';file.multiple=true;file.hidden=true;file.dataset.chipControl='ps1-vab-file';file.setAttribute('aria-label','Choose one VAB or matching VH and VB files');root.appendChild(file);
  const fields=make('div');fields.className='chip-fields';root.appendChild(fields);
  const label=make('label');label.className='chip-field';label.appendChild(make('span','VAB Tone'));
  const tones=make('select');tones.dataset.chipControl='ps1-vab-tone';tones.setAttribute('aria-label','VAB Tone');label.appendChild(tones);fields.appendChild(label);
  const load=make('button');load.type='button';load.dataset.chipAction='ps1-vab-load';fields.appendChild(load);
  const status=make('p','No sound bank opened.');status.className='chip-editor-status';status.dataset.chipOutput='ps1-vab-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status);
  const help=make('p','Standard Sony VAB v6/v7, or select a matching VH + VB together. Load one Tone into the selected Voice, then Hold to play, Sustain play or Use Keyboard. Other voices keep their instruments. Stop running code first if it controls this voice. Imports stay in live SPU RAM; Run/reset may replace them. Key zones/layers and driver vibrato/portamento are not applied; volume/pan are approximate. Reverb send uses current shared settings. PSF is not supported yet.');help.className='subtext';root.appendChild(help);
  const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
  function update() {
    const context=getContext();
    open.disabled=busy||!context.connected;
    tones.disabled=busy||!bank||!context.connected;
    load.disabled=busy||!bank||!context.connected;
    load.textContent=`Load Tone into Voice ${context.channel+1}`;
  }
  function cancel() {sequence++;if(busy)message('VAB operation cancelled.');busy=false;update();}
  const current=(token,context)=>{const next=getContext();return !disposed && token===sequence && next.connected && next.visible && next.epoch===context.epoch && next.channel===context.channel;};
  listen(open,'click',()=>{if(!open.disabled)file.click();});
  listen(file,'change',async()=>{
    const files=Array.from(file.files??[]);file.value='';if(!files.length)return;
    const context=getContext(), token=++sequence;
    if(!context.connected||!context.visible||disposed)return;
    busy=true;update();message('Reading sound bank…');
    try {
      if(files.some(item=>item.size>MAX_VAB_FILE_BYTES))throw new RangeError('Each VAB / VH / VB file must be at most 1 MiB');
      let header,body;
      if(files.length===1&&!/\.vb$/i.test(files[0].name))header=files[0];
      else if(files.length===2){header=files.find(item=>/\.vh$/i.test(item.name));body=files.find(item=>/\.vb$/i.test(item.name));}
      if(!header||files.length>1&&!body)throw new TypeError('Choose one VAB, or one matching VH and VB together');
      const [vh,vb]=await Promise.all([header.arrayBuffer(),body?.arrayBuffer()]);
      if(!current(token,context))return;
      const next=readVab(vh,vb);
      bank=next;name=header.name;
      tones.replaceChildren(...bank.tones.map((tone,index)=>{const option=make('option',`Program ${tone.program} · Tone ${tone.index} · Sample ${tone.sample} · center ${tone.center} · shift +${tone.shift}/128 st · keys ${tone.keyLow}–${tone.keyHigh}`);option.value=String(index);return option;}));
      tones.value='0';
      message(`${name}: ${bank.programs.length} programs · ${bank.tones.length} tones · ${bank.samples.length} samples. Choose a Tone and load it.`);
    } catch(error) {if(current(token,context)){message(`${error.message}${bank?' Previous bank is kept.':''}`,true);onError(error);}}
    finally {if(token===sequence&&!disposed){busy=false;update();}}
  });
  listen(load,'click',async()=>{
    const context=getContext();if(!bank||busy||disposed||!context.connected||!context.visible)return;
    const token=++sequence;busy=true;update();
    try {
      const prepared=prepareVabTone(bank,Number(tones.value));
      const sample=await invoke('loadTone',[context.channel,prepared.adpcm,prepared.options,prepared.preset]);
      if(current(token,context))message(`Loaded ${name} · Program ${prepared.tone.program} · Tone ${prepared.tone.index} into Voice ${context.channel+1} · ${sample.byteLength} ADPCM bytes. Hold to play or Use Keyboard.`);
    } catch(error) {if(current(token,context)&&error.name!=='AbortError'){message(error.message,true);onError(error);}}
    finally {if(token===sequence&&!disposed){busy=false;update();}}
  });
  update();
  return {update,cancel,dispose(){cancel();disposed=true;for(const remove of listeners)remove();}};
}
