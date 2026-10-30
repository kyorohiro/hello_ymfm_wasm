// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {MAX_VAB_FILE_BYTES, readVab, prepareVabTone} from './playground_ps1_vab.js';
import {PSF_FILES,readPsfFileSet,extractPsfVabs,psfRejectionSummary} from './playground_ps1_psf.js';

/** Opening a bank is local-only; loading a Tone is one inspector transaction. */
export function createPlaygroundPs1VabPanel({root, getContext, invoke, onError=()=>{}}) {
  const doc=root.ownerDocument, listeners=[];
  let bank=null, name='', sequence=0, busy=false, disposed=false,psfSet=null,controller=null,bankChoices=[];
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  root.appendChild(make('h4','Import VAB / PSF sound bank'));
  const actions=make('div');actions.className='chip-actions';root.appendChild(actions);
  const open=make('button','Open VAB / VH + VB…');open.type='button';open.dataset.chipAction='ps1-vab-open';actions.appendChild(open);
  const file=make('input');file.type='file';file.accept='.vab,.vh,.vb';file.multiple=true;file.hidden=true;file.dataset.chipControl='ps1-vab-file';file.setAttribute('aria-label','Choose one VAB or matching VH and VB files');root.appendChild(file);
  const psfOpen=make('button','Open PSF set…');psfOpen.type='button';psfOpen.dataset.chipAction='ps1-psf-open';actions.appendChild(psfOpen);
  const psfFolder=make('button','Open PSF folder…');psfFolder.type='button';psfFolder.dataset.chipAction='ps1-psf-folder';actions.appendChild(psfFolder);
  const psfFile=make('input');psfFile.type='file';psfFile.accept='.psf,.psf1,.minipsf,.minipsf1,.psflib,.psf1lib';psfFile.multiple=true;psfFile.hidden=true;psfFile.dataset.chipControl='ps1-psf-file';psfFile.setAttribute('aria-label','Choose PSF and related PSFLib files together');root.appendChild(psfFile);
  const folder=make('input');folder.type='file';folder.multiple=true;folder.hidden=true;folder.setAttribute('webkitdirectory','');folder.dataset.chipControl='ps1-psf-folder';folder.setAttribute('aria-label','Choose a folder containing a PSF set');root.appendChild(folder);
  const psfFields=make('div');psfFields.className='chip-fields';root.appendChild(psfFields);
  const songLabel=make('label');songLabel.className='chip-field';songLabel.appendChild(make('span','PSF entry'));
  const song=make('select');song.dataset.chipControl='ps1-psf-entry';song.setAttribute('aria-label','PSF entry');songLabel.appendChild(song);psfFields.appendChild(songLabel);
  const extract=make('button','Extract VAB banks');extract.type='button';extract.dataset.chipAction='ps1-psf-extract';psfFields.appendChild(extract);
  const fields=make('div');fields.className='chip-fields';root.appendChild(fields);
  const bankLabel=make('label');bankLabel.className='chip-field';bankLabel.appendChild(make('span','Sound bank'));
  const bankSelect=make('select');bankSelect.dataset.chipControl='ps1-vab-bank';bankSelect.setAttribute('aria-label','Extracted sound bank');bankLabel.appendChild(bankSelect);fields.appendChild(bankLabel);
  const label=make('label');label.className='chip-field';label.appendChild(make('span','VAB Tone'));
  const tones=make('select');tones.dataset.chipControl='ps1-vab-tone';tones.setAttribute('aria-label','VAB Tone');label.appendChild(tones);fields.appendChild(label);
  const load=make('button');load.type='button';load.dataset.chipAction='ps1-vab-load';fields.appendChild(load);
  const status=make('p','No sound bank opened.');status.className='chip-editor-status';status.dataset.chipOutput='ps1-vab-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status);
  const help=make('p','Standard Sony VAB v6/v7, or matching VH + VB. For PSF1/MiniPSF, select the song and all referenced PSFLib files together, or open their folder; choose a PSF entry and extract its banks. Static extraction finds contiguous VAB banks in the expanded data. Separate VH/VB layouts, custom formats and runtime-packed banks may not be found. PSF2 and song playback are not supported. No game code is executed. Load one Tone into the selected Voice, then Hold to play, Sustain play or Use Keyboard. Other voices keep their instruments. Stop running code first if it controls this voice. Imports stay in live SPU RAM; Run/reset may replace them. Key zones/layers and driver vibrato/portamento are not applied; volume/pan are approximate. Reverb send uses current shared settings.');help.className='subtext';root.appendChild(help);
  const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
  function update() {
    const context=getContext();
    open.disabled=busy||!context.connected;
    psfOpen.disabled=psfFolder.disabled=busy||!context.connected;
    song.disabled=extract.disabled=busy||!psfSet||!context.connected;
    bankSelect.disabled=busy||!bankChoices.length||!context.connected;
    tones.disabled=busy||!bank||!context.connected;
    load.disabled=busy||!bank||tones.value===''||!context.connected;
    load.textContent=`Load Tone into Voice ${context.channel+1}`;
  }
  function cancel() {sequence++;controller?.abort();controller=null;if(busy)message('Sound bank operation cancelled.');busy=false;update();}
  const current=(token,context)=>{const next=getContext();return !disposed && token===sequence && next.connected && next.visible && next.epoch===context.epoch && next.channel===context.channel;};
  listen(open,'click',()=>{if(!open.disabled)file.click();});
  function chooseBank(index) {
    const choice=bankChoices[index];if(!choice)return;
    bank=choice.bank;name=choice.name;
    const availability=new Map();let first=null;
    tones.replaceChildren(...bank.tones.map((tone,index)=>{
      if(!availability.has(tone.sample)){try{prepareVabTone(bank,index);availability.set(tone.sample,'');}catch(error){availability.set(tone.sample,error.message);}}
      const reason=availability.get(tone.sample),option=make('option',`Program ${tone.program} · Tone ${tone.index} · Sample ${tone.sample} · center ${tone.center} · shift +${tone.shift}/128 st · keys ${tone.keyLow}–${tone.keyHigh}${reason?' · unavailable':''}`);
      option.value=String(index);option.disabled=Boolean(reason);if(reason)option.title=reason;else first??=index;return option;
    }));tones.value=first===null?'':String(first);
  }
  function showBanks(choices) {
    bankChoices=choices;
    bankSelect.replaceChildren(...choices.map((choice,index)=>{const option=make('option',choice.name);option.value=String(index);return option;}));bankSelect.value='0';chooseBank(0);
  }
  listen(bankSelect,'change',()=>{chooseBank(Number(bankSelect.value));update();});
  listen(psfOpen,'click',()=>{if(!psfOpen.disabled)psfFile.click();});
  listen(psfFolder,'click',()=>{if(!psfFolder.disabled)folder.click();});
  async function openPsf(input,isFolder) {
    const selected=Array.from(input.files??[]);input.value='';if(!selected.length)return;
    const context=getContext(),token=++sequence;
    if(!context.connected||!context.visible||disposed)return;
    controller?.abort();controller=new AbortController();const signal=controller.signal;
    busy=true;update();message('Reading PSF set…');
    try {
      const next=await readPsfFileSet(isFolder?selected.filter(item=>PSF_FILES.test(item.name)):selected,{signal});
      if(!current(token,context))return;
      psfSet=next;song.replaceChildren(...next.entries.map(entry=>{const option=make('option',`${entry.path}${entry.title?` · ${entry.title}`:''}`);option.value=entry.path;return option;}));song.value=next.entries[0].path;
      message(`Opened ${next.records.size} PSF/library files. Choose a PSF entry and Extract VAB banks. Current instrument is kept.`);
    }catch(error){if(current(token,context)&&error.name!=='AbortError'){message(error.message,true);onError(error);}}
    finally{if(token===sequence&&!disposed){busy=false;controller=null;update();}}
  }
  listen(psfFile,'change',()=>openPsf(psfFile,false));listen(folder,'change',()=>openPsf(folder,true));
  listen(extract,'click',async()=>{
    const context=getContext();if(!psfSet||busy||disposed||!context.connected||!context.visible)return;
    const token=++sequence;controller=new AbortController();const signal=controller.signal;
    busy=true;update();message('Expanding PSF libraries and searching for VAB banks…');
    try {
      const result=await extractPsfVabs(psfSet,song.value,{signal});
      if(!current(token,context))return;
      if(!result.banks.length){message(`No standard VAB found in ${song.value}. Separate VH/VB layouts, custom or runtime-packed banks need further support.${psfRejectionSummary(result)}${bank?' Previous bank is kept.':''}`);return;}
      showBanks(result.banks.map(found=>({bank:found.bank,name:`${song.value} · VAB @0x${(0x80000000+found.address).toString(16)}`})));
      message(`Extracted ${result.banks.length} VAB banks from ${song.value} (${result.loadedFiles.length} program overlays). Choose a bank and Tone, then load it.${psfRejectionSummary(result)}`);
    }catch(error){if(current(token,context)&&error.name!=='AbortError'){message(error.message,true);onError(error);}}
    finally{if(token===sequence&&!disposed){busy=false;controller=null;update();}}
  });
  listen(file,'change',async()=>{
    const files=Array.from(file.files??[]);file.value='';if(!files.length)return;
    const context=getContext(), token=++sequence;
    if(!context.connected||!context.visible||disposed)return;
    controller?.abort();controller=null;
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
      showBanks([{bank:next,name:header.name}]);
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
