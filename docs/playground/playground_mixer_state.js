import {SoundChipMixer} from '../js/soundchip_mixer.js?v=native-extra-rf5c164-1';

export const MIXER_STATE_PATH = '/mixer/current.json';
export const MIXER_DEFAULT_PRESET_PATH = '/mixer/default.json';
export const MIXER_SYSTEM_PRESET_PATH = '/sys/mixer/default.json';
export const MIXER_DEFAULT_PRESET_JSON = JSON.stringify({version:1,entries:[]},null,2)+'\n';
const LEGACY_STATE_PATH = '/mixer/state.json';
const MAX_JSON_LENGTH = 2 * 1024 * 1024;
const isProjectPreset = path => typeof path==='string'&&/^\/mixer\/[^/]+\.json$/i.test(path);

/** Presets and the current mix are project files. No separate common-default
 * storage or audio polling: only authored Mixer changes schedule a write. */
export function createPlaygroundMixerState({mixer,files,onWrite=()=>{},onError=()=>{},
  delayMs=250,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let applying=false,writing=false,replacing=false,disposed=false,dirty=false,timer=null;
  let blockedPath=null,revision=-1,legacyRevision=-1,legacyAllowed=true,modelJson='';
  let presets=[],presetSignature='';
  const listeners=new Set();
  const cancel=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const schedule=()=>{cancel();timer=setTimer(()=>{timer=null;flush();},delayMs);};
  const error=(message,cause)=>onError(new Error(message+(cause?`: ${cause.message??cause}`:'')));
  const validateText=(text,label)=>{
    if(typeof text!=='string'||text.length>MAX_JSON_LENGTH||new TextEncoder().encode(text).byteLength>MAX_JSON_LENGTH)throw new Error(`${label} must be JSON text under 2 MiB`);
  };
  function capture() {
    const state=mixer.exportState(),{kinds}=mixer.exportDefaults();
    return {version:1,...(kinds.length?{kinds}:{}),entries:state.entries};
  }
  function parse(text) {
    validateText(text,'Mixer preset');
    const source=JSON.parse(text);
    if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(key=>!['version','kinds','entries'].includes(key)))throw new Error('Invalid Mixer preset');
    const validator=new SoundChipMixer();
    validator.configureDefaults({version:source.version,kinds:Object.hasOwn(source,'kinds')?source.kinds:[]});
    validator.restoreState({version:source.version,entries:source.entries});
    const {kinds}=validator.exportDefaults();
    return {version:1,...(kinds.length?{kinds}:{}),entries:validator.exportState().entries};
  }
  function apply(preset) {
    applying=true;
    try {
      mixer.restoreState({version:1,entries:preset.entries},{version:1,kinds:preset.kinds??[]});
    } finally{applying=false;modelJson=JSON.stringify(capture());}
  }
  function occupied(path) {return files.has(path)||files.listDirectories().includes(path);}
  function read(path) {
    if(path===MIXER_SYSTEM_PRESET_PATH)return {version:1,entries:[]};
    if(!isProjectPreset(path))throw new Error('Choose a JSON preset from mixer/');
    const file=files.get(path);
    if(!file||file.type!=='text')throw new Error(`Expected a JSON text file: ${path}`);
    return parse(file.data);
  }
  function notifyPresets(change) {
    for(const listener of listeners){try{listener(change);}catch(cause){error('Mixer preset list could not be refreshed',cause);}}
  }
  function refreshPresets() {
    let names=[];
    try{names=files.readdir('/mixer');}catch{/* No mixer folder yet. */}
    const next=[{path:MIXER_SYSTEM_PRESET_PATH,label:'System — built-in (read-only)'},
      ...names.filter(name=>isProjectPreset('/mixer/'+name)&&files.has('/mixer/'+name))
        .map(name=>({path:'/mixer/'+name,label:'mixer/'+name}))];
    const signature=JSON.stringify(next);
    if(signature===presetSignature)return;
    presets=next;presetSignature=signature;
    notifyPresets();
  }
  function loadProject({resetOnError=false}={}) {
    cancel();dirty=false;blockedPath=null;
    revision=files.getRevision(MIXER_STATE_PATH);legacyRevision=files.getRevision(LEGACY_STATE_PATH);
    const hasCurrent=occupied(MIXER_STATE_PATH);
    if(hasCurrent)legacyAllowed=false;
    const path=hasCurrent?MIXER_STATE_PATH
      :legacyAllowed&&occupied(LEGACY_STATE_PATH)?LEGACY_STATE_PATH
      :occupied(MIXER_DEFAULT_PRESET_PATH)?MIXER_DEFAULT_PRESET_PATH:MIXER_SYSTEM_PRESET_PATH;
    try {
      apply(read(path));
    } catch(cause) {
      blockedPath=path;
      if(resetOnError)apply({version:1,entries:[]});
      error(`Could not load ${path}; fix the file or select another preset`,cause);
    }
    refreshPresets();
    // Loading a project already applies its source. Keep the selector aligned
    // without reapplying it, even when both projects have the same filenames.
    notifyPresets({source:path});
  }
  function flush() {
    cancel();
    if(disposed||!dirty)return true;
    if(blockedPath){error(`Fix ${blockedPath} before saving Mixer changes`);return false;}
    try {
      const text=JSON.stringify(capture(),null,2)+'\n';validateText(text,'Current Mixer settings');
      const before=files.get(MIXER_STATE_PATH);
      writing=true;
      try{if(before?.type!=='text'||before.data!==text)files.writeText(MIXER_STATE_PATH,text);}
      finally{writing=false;}
      dirty=false;revision=files.getRevision(MIXER_STATE_PATH);legacyAllowed=false;
      refreshPresets();
      if(before?.data!==text)onWrite(MIXER_STATE_PATH,{created:!before,removed:false});
      return true;
    } catch(cause){error('Current Mixer settings could not be saved',cause);return false;}
  }
  loadProject({resetOnError:true});
  const releaseMixer=mixer.subscribe((_entries,change)=>{
    if(applying||disposed)return;
    const next=JSON.stringify(capture());
    if(change?.sourceLifecycle){modelJson=next;return;}
    if(next===modelJson)return;
    modelJson=next;dirty=true;schedule();notifyPresets({source:MIXER_STATE_PATH});
  });
  const releaseFiles=files.onDidChange(()=>{
    if(writing||replacing||disposed)return;
    if(files.getRevision(MIXER_STATE_PATH)!==revision||
        legacyAllowed&&files.getRevision(LEGACY_STATE_PATH)!==legacyRevision)loadProject();
    else refreshPresets();
  });
  function saveSnapshot(path,overwrite=false) {
    if(disposed)throw new Error('Mixer settings were disposed');
    if(blockedPath)throw new Error(`Fix ${blockedPath} before saving a Mixer preset`);
    const before=files.get(path);
    if(occupied(path)&&(!overwrite||!before))throw new Error(`Mixer preset already exists: ${path}`);
    if(!flush())throw new Error('Current Mixer settings could not be saved');
    const text=JSON.stringify(capture(),null,2)+'\n';validateText(text,'Mixer preset');
    writing=true;
    try{if(before?.type!=='text'||before.data!==text)files.writeText(path,text);}
    finally{writing=false;}
    refreshPresets();
    if(before?.data!==text)onWrite(path,{created:!before,removed:false});
    return path;
  }
  return {
    flush,
    listPresets(){return presets.map(preset=>({...preset}));},
    subscribePresets(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    selectPreset(path) {
      if(disposed)throw new Error('Mixer settings were disposed');
      if(path===MIXER_STATE_PATH&&dirty&&!blockedPath&&!flush())throw new Error('Current Mixer settings could not be saved');
      const preset=read(path);
      // Finish edits made before selection; never save the auditioned preset.
      if(dirty&&!flush())throw new Error('Current Mixer edits could not be saved');
      cancel();apply(preset);dirty=false;
      if(blockedPath!==MIXER_STATE_PATH)blockedPath=null;
    },
    saveDefault(){return saveSnapshot(MIXER_DEFAULT_PRESET_PATH,true);},
    savePreset(name) {
      if(typeof name!=='string')throw new Error('Enter a preset name');
      const value=name.trim(),stem=value.replace(/\.json$/i,'');
      if(!stem.trim()||value.length>120||/[\\/\u0000-\u001f\u007f]/.test(value)||stem==='.'||stem==='..')throw new Error('Use a preset name of 1–120 characters without slashes or control characters');
      const filename=/\.json$/i.test(value)?value:value+'.json';
      if(filename.length>120)throw new Error('Use a preset filename of at most 120 characters including .json');
      if(['current.json','default.json'].includes(filename.toLowerCase()))throw new Error('Use Set default for default.json, or choose a different preset name');
      return saveSnapshot('/mixer/'+filename);
    },
    replaceProject(operation) {
      const previousDirty=dirty;cancel();dirty=false;replacing=true;
      let result;
      try{result=operation();}
      catch(cause){replacing=false;dirty=previousDirty;if(dirty)schedule();throw cause;}
      replacing=false;legacyAllowed=true;loadProject({resetOnError:true});return result;
    },
    dispose(){if(disposed)return;flush();disposed=true;cancel();releaseMixer();releaseFiles();listeners.clear();},
  };
}
