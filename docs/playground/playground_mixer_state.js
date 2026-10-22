export const MIXER_STATE_PATH = '/mixer/state.json';
export const MIXER_DEFAULTS_KEY = 'tetorica.playground.mixer.defaults.v1';
const EMPTY_STATE = {version:1,entries:[]};
const EMPTY_DEFAULTS = {version:1,kinds:[]};
// Covers the core's 512 bounded records, even with JSON-escaped identifiers.
const MAX_JSON_LENGTH = 2 * 1024 * 1024;

/** Storage belongs to the app; SoundChipMixer only owns validated policies.
 * Project writes follow explicit settings changes, never meters/audio polling. */
export function createPlaygroundMixerState({mixer,files,getStorage=()=>globalThis.localStorage,
  onWrite=()=>{},onError=()=>{},delayMs=250,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let applying=false,writing=false,replacing=false,disposed=false,dirty=false,blocked=false,timer=null;
  let revision=-1,modelJson='';
  const cancel=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const error=(message,cause)=>onError(new Error(message+(cause?`: ${cause.message??cause}`:'')));
  const validateText=(text,label)=>{
    if(typeof text!=='string'||text.length>MAX_JSON_LENGTH||new TextEncoder().encode(text).byteLength>MAX_JSON_LENGTH)throw new Error(`${label} must be JSON text under 2 MiB`);
  };
  const parse=(text,label)=>{validateText(text,label);return JSON.parse(text);};
  function apply(operation) {
    applying=true;
    try{return operation();}
    finally{applying=false;modelJson=JSON.stringify(mixer.exportState());}
  }
  function loadDefaults() {
    try {
      const source=getStorage()?.getItem(MIXER_DEFAULTS_KEY);
      if(source!==null&&source!==undefined)apply(()=>mixer.configureDefaults(parse(source,'Common Mixer defaults')));
    } catch(cause){error('Common Mixer defaults could not be loaded',cause);}
  }
  function loadProject({resetOnError=false}={}) {
    cancel();dirty=false;blocked=false;
    revision=files.getRevision(MIXER_STATE_PATH);
    try {
      const file=files.get(MIXER_STATE_PATH);
      if(file&&file.type!=='text')throw new Error('Expected a JSON text file');
      if(!file&&files.listDirectories().includes(MIXER_STATE_PATH))throw new Error('The settings path is a directory');
      apply(()=>mixer.restoreState(file?parse(file.data,'Project Mixer settings'):EMPTY_STATE));
    } catch(cause) {
      blocked=true;
      if(resetOnError)apply(()=>mixer.restoreState(EMPTY_STATE));
      error(`Could not load ${MIXER_STATE_PATH}; fix the file to save Mixer changes`,cause);
    }
  }
  function flush() {
    cancel();
    if(disposed||!dirty)return true;
    if(blocked){error(`Fix ${MIXER_STATE_PATH} before saving Mixer changes`);return false;}
    try {
      const state=mixer.exportState(),text=JSON.stringify(state,null,2)+'\n';
      validateText(text,'Project Mixer settings');
      const before=files.get(MIXER_STATE_PATH);
      writing=true;
      try {
        if(state.entries.length){if(before?.type!=='text'||before.data!==text)files.writeText(MIXER_STATE_PATH,text);}
        else if(before)files.delete(MIXER_STATE_PATH);
      } finally{writing=false;}
      dirty=false;revision=files.getRevision(MIXER_STATE_PATH);
      const after=files.get(MIXER_STATE_PATH);
      if(before?.data!==after?.data)onWrite(MIXER_STATE_PATH,{created:!before&&Boolean(after),removed:Boolean(before)&&!after});
      return true;
    } catch(cause){error('Project Mixer settings could not be saved',cause);return false;}
  }
  loadDefaults();loadProject({resetOnError:true});
  const releaseMixer=mixer.subscribe(()=>{
    if(applying||disposed)return;
    const next=JSON.stringify(mixer.exportState());
    if(next===modelJson)return;
    modelJson=next;dirty=true;cancel();timer=setTimer(()=>{timer=null;flush();},delayMs);
  });
  const releaseFiles=files.onDidChange(()=>{
    if(writing||replacing||disposed||files.getRevision(MIXER_STATE_PATH)===revision)return;
    loadProject();
  });
  function saveDefaults(operation) {
    if(disposed)throw new Error('Mixer settings were disposed');
    const previous=mixer.exportDefaults();
    try {
      apply(operation);
      const storage=getStorage();if(!storage)throw new Error('Browser storage is unavailable');
      storage.setItem(MIXER_DEFAULTS_KEY,JSON.stringify(mixer.exportDefaults()));
    } catch(cause){apply(()=>mixer.configureDefaults(previous));throw new Error(`Common Mixer defaults could not be saved: ${cause.message??cause}`);}
  }
  return {
    flush,
    saveDefault(id) {
      const entry=mixer.list().find(value=>value.id===id&&value.connected);
      if(!entry)throw new Error('Connect the sound chip before saving its common default');
      saveDefaults(()=>mixer.setKindDefault(entry.name,{volume:entry.volume,pan:entry.pan}));
    },
    resetDefaults(){saveDefaults(()=>mixer.configureDefaults(EMPTY_DEFAULTS));},
    resetProject(id){mixer.reset(id);flush();},
    replaceProject(operation) {
      const previousDirty=dirty;cancel();dirty=false;replacing=true;
      let result;
      try{result=operation();}
      catch(cause){
        replacing=false;dirty=previousDirty;
        if(dirty)timer=setTimer(()=>{timer=null;flush();},delayMs);
        throw cause;
      }
      replacing=false;loadProject({resetOnError:true});return result;
    },
    dispose(){if(disposed)return;flush();disposed=true;cancel();releaseMixer();releaseFiles();},
  };
}
