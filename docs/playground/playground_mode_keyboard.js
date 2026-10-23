import {keyboardChannels,keyboardChannelHint} from '../js/playground_keyboard_channels.js?v=native-extra-huc6280-1';

/** The mode's primary instrument is playable before a script binds Keyboard.
 * Resolve its admin endpoint after audio preparation; never create a second chip.
 */
const TARGETS = {
  gameboy: ['gameboy', 'Game Boy · Pulse 1'],
  nes: ['nes', 'NES + FDS · Pulse 1'],
  snes: ['snes', 'SNES · Voice 1'],
  x68000: ['ym2151', 'YM2151 · CH1'],
  huc6280: ['huc6280', 'HuC6280 · CH1'],
  segapsg: ['segapsg', 'Sega PSG · Tone 1'],
  dx7: ['dx7', 'DX7'],
  ym3812: ['ym3812', 'OPL2 · CH1'],
  ym3526: ['ym3526', 'OPL · CH1'],
  y8950: ['y8950', 'Y8950 · CH1'],
  ymf262: ['ymf262', 'OPL3 · CH1'],
  ym2413: ['ym2413', 'YM2413 OPLL · CH1'],
  ay8910: ['ay8910', 'AY-3-8910 · CH1'],
  msx: ['ym2413', 'MSX · YM2413 OPLL CH1'],
  'msx-audio': ['y8950', 'MSX Audio · Y8950 CH1'],
};
let sequence = 0;

/** Authoring environments may contain several primary physical sound chips. */
export function playgroundPrimaryKeyboardChips(mode,capabilities = {}) {
  const chip = mode.chip;
  if (chip === 'msx' || chip === 'msx-audio') return [
    ...(chip === 'msx-audio' ? [{id:'y8950',kind:'y8950',label:'Y8950 FM (primary)'}] : []),
    {id:'ym2413',kind:'ym2413',label:'YM2413 OPLL (primary)'},
    {id:'ay8910',kind:'ay8910',label:'AY-3-8910 (primary)'},
  ];
  if (chip === 'x68000') return [{id:'ym2151',kind:'ym2151',label:'YM2151 (primary)'},{id:'okim6258',kind:'okim6258',label:'OKIM6258 (primary)'}];
  const entries = [{id:chip,kind:chip,label:`${({gameboy:'Game Boy',nes:'NES + FDS',huc6280:'HuC6280'})[chip] ?? chip.toUpperCase()} (primary)`,...(chip === 'nes' ? {fdsEnabled:true} : {})}];
  if (mode.ym2413) entries.push({id:'ym2413',kind:'ym2413',label:'YM2413 OPLL (primary)'});
  if (chip === 'ym2612') {
    if (capabilities.psg) entries.push({id:'segapsg',kind:'segapsg',label:'Sega PSG (primary)'});
    if (capabilities.pcm) entries.push({id:'rf5c164',kind:'rf5c164',label:'RF5C164 (primary)'});
    if (mode.mega32X || mode.full) entries.push({id:'pwm',kind:'pwm',label:'32X PWM (primary)'});
  }
  return entries;
}

export function createPlaygroundModeKeyboard({chip, getInspector}) {
  const definition = TARGETS[chip];
  if (!definition) return null;
  const [primaryId, name] = definition, prefix = `mode-keyboard-${++sequence}-`;
  const held = new Map();
  let noteSequence = 0;
  function release(id) {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    // A new runtime must not receive releases belonging to an old runtime.
    if (getInspector() !== entry.source) return;
    return entry.source.invoke(primaryId, 'auditionOff', [0, entry.noteId]);
  }
  return {
    name,
    async noteOn(event) {
      const source = getInspector();
      if (!source?.list().some(entry => entry.id === primaryId && entry.connected !== false)) {
        throw new Error(`${name} is not ready. Prepare audio or Run the mode's code first.`);
      }
      const previous = release(event.id);
      const entry = {source, noteId: `${prefix}${++noteSequence}`};
      held.set(event.id, entry);
      try {
        if (previous?.then) await previous;
        if (held.get(event.id) !== entry || getInspector() !== source) return;
        await source.invoke(primaryId, 'auditionOn', [0, event.midi, entry.noteId, event.velocity ?? 100]);
      } catch (error) {
        if (held.get(event.id) === entry) held.delete(event.id);
        throw error;
      }
    },
    noteOff(event) {return release(event.id);},
    allNotesOff() {return Promise.allSettled([...held.keys()].map(release));},
  };
}

/** Chip/voice selection is metadata only. Audio commands are sent by held keys.
 * Primary placeholders permit selection before audio is prepared; added chips
 * are listed only while their actual instance is connected.
 */
export function createPlaygroundKeyboardRouting({getInspector,primaryChips=[],defaultChipId=primaryChips[0]?.id,onTargetChange=()=>{}}) {
  const hardwareId=id=>`chip:${id}`,customId=source=>`instrument:${source}`;
  const listeners=new Set(),customs=new Map(),channelChoices=new Map(),targetCache=new Map();
  let source=null,unsubscribe=null,disposed=false,chips=[],selected=hardwareId(defaultChipId),channelId='',lastHardware=selected,currentTarget=null;
  const prefix=`keyboard-route-${++sequence}-`;let noteSequence=0;
  function descriptor(entry) {
    const channels=keyboardChannels(entry.kind,entry);
    const fm=channels.filter(channel=>channel.id.startsWith('fm:'));
    if(fm.length>1)channels.push({id:'fm:all',label:'FM · Round robin'});
    return {...entry,id:hardwareId(entry.id),endpointId:entry.id,channels,disabled:!channels.length};
  }
  const selectedChip=()=>chips.find(chip=>chip.id===selected);
  function getState(){const chip=selectedChip();return {chips:chips.map(entry=>({...entry,hint:entry.custom?'Uses the connected instrument’s own note and channel mapping.':keyboardChannelHint(entry.kind,channelId)})),chipId:selected,channelId,customTarget:chip?.custom?{id:chip.id,label:chip.label}:undefined};}
  function releaseEntry(held,id) {
    const entry=held.get(id);if(!entry)return;held.delete(id);
    const inspector=getInspector();
    if(inspector!==entry.source)return;
    try{if(inspector.getConnectionToken&&inspector.getConnectionToken(entry.endpointId)!==entry.connection)return;}
    catch{return;}
    return inspector.invoke(entry.endpointId,'auditionOff',[entry.channel,entry.noteId]);
  }
  function hardwareTarget(chip,voiceId,scope='keyboard') {
    const key=JSON.stringify([scope,chip.id,voiceId]);if(targetCache.has(key))return targetCache.get(key);
    const held=new Map();let roundRobin=0;
    const nativeChannel=id=>/^\d+$/.test(id)?Number(id):id;
    const target={
      name:`${chip.label} · ${chip.channels.find(channel=>channel.id===voiceId)?.label??voiceId}`,
      async noteOn(event){
        const inspector=getInspector();
        if(!inspector?.list().some(entry=>entry.id===chip.endpointId&&entry.kind===chip.kind&&entry.connected!==false))throw new Error(`${chip.label} is not connected. Prepare audio or Run your code first.`);
        const previous=releaseEntry(held,event.id);
        const voices=chip.channels.filter(channel=>channel.id.startsWith('fm:')&&channel.id!=='fm:all');
        const actual=voiceId==='fm:all'?voices[roundRobin++%voices.length].id:voiceId;
        const entry={source:inspector,endpointId:chip.endpointId,connection:inspector.getConnectionToken?.(chip.endpointId),channel:nativeChannel(actual),noteId:`${prefix}${++noteSequence}`};
        held.set(event.id,entry);
        try{
          if(previous?.then)await previous;
          if(held.get(event.id)!==entry||getInspector()!==inspector)return;
          if(inspector.getConnectionToken&&inspector.getConnectionToken(chip.endpointId)!==entry.connection)return;
          await inspector.invoke(chip.endpointId,'auditionOn',[entry.channel,event.midi,entry.noteId,event.velocity??100]);
        }catch(error){if(held.get(event.id)===entry)held.delete(event.id);throw error;}
      },
      noteOff(event){return releaseEntry(held,event.id);},
      allNotesOff(){return Promise.allSettled([...held.keys()].map(id=>releaseEntry(held,id)));},
    };
    targetCache.set(key,target);return target;
  }
  function commit(){
    const chip=selectedChip(),next=chip&&!chip.disabled?(chip.custom?chip.target:hardwareTarget(chip,channelId)):null;
    if(next!==currentTarget){
      const previous=currentTarget;currentTarget=next;
      // Hardware targets own exactly their audition IDs. A custom instrument's
      // global allNotesOff belongs to the Keyboard's held-note lifecycle.
      if(previous&&[...targetCache.values()].includes(previous))void previous.allNotesOff();
      onTargetChange(next);
    }
    for(const listener of listeners)listener(getState());
  }
  function reconcile(){
    if(!chips.some(chip=>chip.id===selected))selected=chips.some(chip=>chip.id===lastHardware)?lastHardware:chips.find(chip=>chip.id===hardwareId(defaultChipId))?.id??chips[0]?.id??'';
    const chip=selectedChip(),saved=channelChoices.get(selected);
    channelId=chip?.channels.some(channel=>channel.id===saved)?saved:chip?.channels[0]?.id??'';
    if(!chip?.custom&&chip){lastHardware=selected;channelChoices.set(selected,channelId);}
    commit();
  }
  function refresh(){
    if(disposed)return;
    const next=getInspector()??null;
    if(next!==source){unsubscribe?.();source=next;unsubscribe=source?.subscribe?.(()=>refresh())??null;}
    const actual=source?.list()??[],merged=new Map(primaryChips.map(entry=>[entry.id,entry]));
    for(const entry of actual)merged.set(entry.id,entry);
    chips=[...merged.values()].map(descriptor);
    for(const [origin,target]of customs)chips.push({id:customId(origin),label:`${origin==='script'?'Script':'Voice panel'} · ${target.name}`,channels:[{id:'instrument',label:'Instrument'}],target,custom:true});
    reconcile();
  }
  // Initial construction is side-effect free; the host attaches getTarget()
  // after constructing its Keyboard, before any user gesture prepares audio.
  const initial=onTargetChange;onTargetChange=()=>{};refresh();onTargetChange=initial;
  return {
    getState,getTarget:()=>currentTarget,refresh,
    // An editor auditions its selected hardware voice without changing the
    // bottom Keyboard's manual route or borrowing that route's held-note IDs.
    getEditorTarget(instanceId,voiceId) {
      const chip=chips.find(entry=>!entry.custom&&entry.endpointId===instanceId);
      const voice=chip?.channels.find(entry=>entry.id===String(voiceId));
      return chip&&!chip.disabled&&voice&&!voice.disabled?hardwareTarget(chip,voice.id,'editor'):null;
    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    selectChip(id){if(disposed||!chips.some(chip=>chip.id===id))return;selected=id;reconcile();},
    selectChannel(id){const chip=selectedChip();if(disposed||!chip?.channels.some(channel=>channel.id===id))return;channelChoices.set(selected,id);reconcile();},
    setCustomTarget(origin,target,{select=Boolean(target)}={}){if(disposed)return;if(target)customs.set(origin,target);else customs.delete(origin);if(select&&target)selected=customId(origin);refresh();},
    dispose(){if(disposed)return;disposed=true;unsubscribe?.();for(const target of targetCache.values())void target.allNotesOff();listeners.clear();customs.clear();},
  };
}
