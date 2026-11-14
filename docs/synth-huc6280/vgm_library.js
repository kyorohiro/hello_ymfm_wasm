// SPDX-License-Identifier: BSD-3-Clause
import {extractVgmInstruments, MAX_VGM_BYTES} from './vgm_import.js?v=huc-song-1';
import {decodeDdaData} from './dda_pcm.js';
import {mergeVgmVolumeVariants} from './vgm_pcm_variants.js';
import {prepareHuc6280SongSource} from './song_source.js';

/** Passive file analysis. Only choosing a sound asks the host to replace its
 * instrument; opening, failing, cancelling or closing a library never does. */
export function createVgmLibrary({root, onSelect, onSource, extract=extractVgmInstruments,prepareSong=prepareHuc6280SongSource}) {
  const doc = root.ownerDocument, $ = id => root.querySelector(`#${id}`)??doc.getElementById?.(id);
  const events = new AbortController(), pageSize = 24;
  const pcmInfo = new WeakMap();
  let library = null, filter = 'all', page = 0, selected = null;
  let request = 0, selection = 0, pending = null, disposed = false;
  const listen = (node, type, handler) => node.addEventListener(type, handler, {signal:events.signal});
  const status = (message, error = false) => {
    $('vgmStatus').textContent = message;
    $('vgmStatus').dataset.error = String(error);
  };
  const visibleVoices = () => !library ? [] : $('vgmKeepLoudestPcm').checked
    ? library.loudestVolumeVoices ??= mergeVgmVolumeVariants(library.voices) : library.voices;
  const pcmDescription = voice => {
    let description = pcmInfo.get(voice);
    if (description) return description;
    const {data, sampleRate, loop} = voice.preset.dda;
    const seconds = decodeDdaData(data).length / sampleRate;
    const origins = voice.origins ?? [voice.origin];
    const names = [['stream','DAC stream'],['direct','Direct DAC']].filter(([origin]) => origins.includes(origin)).map(([,label]) => label);
    const source = names.length ? `${names.join(' + ')} · ` : '';
    const approximate = Number(sampleRate.toFixed(6)) !== sampleRate ? '≈' : '';
    const rate = sampleRate.toLocaleString('en-US', {maximumFractionDigits:6});
    const variants=voice.volumeVariants>1?` · ${voice.volumeVariants} volume variants grouped`:'';
    description = `${source}${approximate}${rate} Hz · ${seconds.toFixed(2)} s · ${loop ? 'Loop' : 'One-shot'} · level ${voice.preset.volume}/31${variants} · C4 = recorded rate`;
    pcmInfo.set(voice, description);
    return description;
  };

  function renderWarnings() {
    const voice = visibleVoices().find(value => value.id === selected);
    const messages = [...new Set([...(library?.warnings ?? []), ...(voice?.warnings ?? [])])];
    $('vgmWarnings').textContent = messages.join(' ');
    $('vgmWarnings').hidden = messages.length === 0;
  }
  function render() {
    $('vgmLibrary').hidden = !library;
    if (!library) return;
    const available=visibleVoices();
    const voices = available.filter(voice => filter === 'all' || voice.kind === filter);
    page = Math.max(0, Math.min(page, Math.ceil(voices.length / pageSize) - 1));
    $('vgmFileName').textContent = library.name;
    const start = page * pageSize;
    $('vgmPage').textContent = voices.length
      ? `${start + 1}–${Math.min(start + pageSize, voices.length)} / ${voices.length} sounds` : 'No sounds in this source';
    $('vgmPrevious').disabled = page === 0;
    $('vgmNext').disabled = start + pageSize >= voices.length;
    for (const button of root.querySelectorAll('[data-vgm-filter]')) {
      const kind = button.dataset.vgmFilter;
      const count = kind === 'all' ? available.length : available.filter(voice => voice.kind === kind).length;
      button.textContent = `${kind === 'all' ? 'All' : ['lfo','pcm'].includes(kind) ? kind.toUpperCase() : kind[0].toUpperCase() + kind.slice(1)} (${count})`;
      button.setAttribute('aria-pressed', String(filter === kind));
      button.disabled = count === 0;
    }
    const source = library;
    const buttons = voices.slice(start, start + pageSize).map(voice => {
      const button = doc.createElement('button');
      button.type = 'button'; button.dataset.vgmVoice = String(voice.id);
      button.setAttribute('aria-pressed', String(voice.id === selected));
      const name = doc.createElement('span'); name.textContent = voice.preset.name;
      const detail = doc.createElement('small');
      const channel = voice.kind === 'lfo' ? 'CH1 + CH2 · C4 = recorded pitch' : `CH${voice.channel}`;
      const pcm = voice.kind === 'pcm' ? ` · ${pcmDescription(voice)}` : '';
      const wave = voice.kind === 'wave' ? ` · level ${voice.preset.volume}/31${voice.volumeVariants>1?` · ${voice.volumeVariants} volume variants grouped`:''}` : '';
      detail.textContent = `${channel}${pcm}${wave} · first at ${(voice.firstTime / 44100).toFixed(2)} s · ${voice.occurrences} ${voice.occurrences === 1 ? 'use' : 'uses'}`;
      button.append(name, detail);
      button.addEventListener('click', async () => {
        button.blur();
        if (disposed || source !== library || !visibleVoices().some(value=>value.id===voice.id)) return;
        const token = ++selection;
        try {
          await onSelect(voice.preset);
          if (disposed || token !== selection || source !== library) return;
          selected = voice.id; render();
          const playing = voice.kind === 'lfo' ? 'C4 plays the recorded carrier pitch; CH2 period stays fixed.'
            : voice.kind === 'pcm' ? `DDA PCM · ${pcmDescription(voice)}. Play the keyboard; other keys change the software playback speed.`
              : 'Play the keyboard.';
          status(`${voice.preset.name} loaded · ${playing} Software Envelope is off for imported sounds.`);
        } catch (error) {
          if (!disposed && token === selection && source === library) status(`Could not load sound: ${error.message}`, true);
        }
      });
      return button;
    });
    $('vgmVoices').replaceChildren(...buttons);
    renderWarnings();
  }
  function cancel() {
    request++; selection++;
    pending?.abort(); pending = null;
    $('vgmLibrary').dataset.loading = 'false';
    $('cancelVgm').hidden = true;
  }
  listen($('loadVgm'), 'click', () => {$('loadVgm').blur(); $('vgmFileInput').click();});
  listen($('vgmKeepLoudestPcm'),'change',()=>{
    $('vgmKeepLoudestPcm').blur();selection++;page=0;
    const available=visibleVoices();
    if (selected!==null&&!available.some(voice=>voice.id===selected)) selected=null;
    render();
    if (library) status(`${available.length} sounds shown · ${$('vgmKeepLoudestPcm').checked?'loudest Wave / PCM volume variants grouped':'all Wave / PCM volume variants shown'}. Current instrument kept.`);
  });
  listen($('vgmFileInput'), 'cancel', () => {
    $('vgmFileInput').blur();
    if (!pending) status('File selection cancelled. Current sound kept.');
  });
  listen($('vgmFileInput'), 'change', async () => {
    const file = $('vgmFileInput').files?.[0];
    $('vgmFileInput').value = ''; $('vgmFileInput').blur();
    if (!file || disposed) return;
    root.open=true;
    cancel();
    const token = request, controller = new AbortController(); pending = controller;
    $('vgmLibrary').dataset.loading = 'true'; $('cancelVgm').hidden = false;
    status(`Reading ${file.name}…`);
    try {
      if (file.size > MAX_VGM_BYTES) throw new Error('VGM / VGZ files must be at most 64 MiB.');
      const bytes = await file.arrayBuffer();
      if (disposed || token !== request) return;
      if(bytes.byteLength>MAX_VGM_BYTES)throw new Error('VGM / VGZ files must be at most 64 MiB.');
      const result = await extract(bytes, {signal:controller.signal,allowEmpty:true});
      if (disposed || token !== request) return;
      // Extraction can omit an incomplete Wave RAM or DAC snapshot. Without
      // any static sound, retain the file only if its complete song timeline
      // is usable; an omitted malformed stream must not replace the library.
      if(!result.voices.length){
        await prepareSong(bytes,{signal:controller.signal});
        if(disposed||token!==request||controller.signal.aborted)return;
      }
      library = {...result, name:file.name}; filter = 'all'; page = 0; selected = null; selection++;
      render();
      const current=()=>!disposed&&token===request&&!controller.signal.aborted;
      let sourceMessage='',sourceFailed=false;
      if(onSource){
        try{
          // Archive a stable loudest-volume snapshot even when the user later
          // expands the library view to inspect every volume variant.
          const saved=await onSource({name:file.name,bytes:new Uint8Array(bytes),voices:mergeVgmVolumeVariants(result.voices)}, {isCurrent:current,signal:controller.signal});
          if(!current())return;
          const path=typeof saved==='string'?saved:saved?.songPath;
          if(!path)throw Error('The source was not added to Files.');
          sourceMessage=` Reference song saved to ${path}; press Play in the song player.`;
          if(saved?.presetPaths?.length)sourceMessage+=` ${saved.presetPaths.length} preset(s) saved to ${saved.presetDirectory??'/presets/'} with loudest Wave / PCM volume variants.`;
          if(saved?.persisted===false){sourceFailed=true;sourceMessage+=' Files are available in memory; local save unavailable. Export the project to keep them.';}
        }catch(error){
          if(!current()||error.name==='AbortError')return;
          sourceFailed=true;sourceMessage=` Extracted sounds remain available. Reference song and presets not saved to Files: ${error.message}`;
        }
      }
      if(!current())return;
      const count=visibleVoices().length;
      status(`${count} sounds found${count?' · choose one to play':''}.${sourceMessage} Current instrument kept.`,sourceFailed);
    } catch (error) {
      if (!disposed && token === request && error.name !== 'AbortError') status(`VGM import failed: ${error.message} Current sound kept.`, true);
    } finally {
      if (token === request) {pending = null; $('vgmLibrary').dataset.loading = 'false'; $('cancelVgm').hidden = true;}
    }
  });
  listen($('cancelVgm'), 'click', () => {
    $('cancelVgm').blur(); cancel(); status('VGM import cancelled. Current sound kept.');
  });
  listen($('closeVgm'), 'click', () => {
    $('closeVgm').blur(); cancel(); library = null; selected = null;
    $('vgmVoices').replaceChildren(); render(); status('Library closed. Current instrument kept.');
  });
  for (const button of root.querySelectorAll('[data-vgm-filter]')) listen(button, 'click', () => {
    button.blur(); filter = button.dataset.vgmFilter; page = 0; render();
  });
  for (const [id, direction] of [['vgmPrevious', -1], ['vgmNext', 1]]) listen($(id), 'click', () => {
    $(id).blur(); page += direction; render();
  });
  return {
    clearSelection() {selection++; selected = null; render();},
    dispose() {if (disposed) return; disposed = true; cancel(); events.abort();},
  };
}
