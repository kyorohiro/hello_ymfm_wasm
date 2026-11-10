// Select the existing Playground interfaces used by the lightweight Code host.
// No browser/compiler dependency: declaration fetch and Monaco stay lazy.
export const SYNTH_CODE_GLOBALS=Object.freeze([
  'context','fm','fx','FM_PRESETS','CH1','CH2','CH3','CH4','CH5','CH6','PSG1','PSG2','PSG3','OP1','OP2','OP3','OP4',
  'console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween','liveLoop','livePrepare','liveFx',
  'stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','toPitch','noteToBlockFnum','noteLerp','hzToBlockFnum',
  'midiToNoteName','scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
]);

/** Read whole top-level type/interface/ambient declarations, including multiline
 * signatures. Braces and semicolons inside comments or strings are ignored. */
function declarations(source) {
  const values=[];
  const pattern=/^(?:(declare)\s+(?:function|const|var)|(type|interface))\s+([A-Za-z_$][\w$]*)/gm;
  for(const match of source.matchAll(pattern)) {
    const start=match.index,kind=match[1]?'global':match[2];
    let braces=0,parens=0,brackets=0,quote=null,comment=null,opened=false,end=source.length;
    for(let i=start;i<source.length;i++) {
      const c=source[i],next=source[i+1];
      if(comment==='line'){if(c==='\n')comment=null;continue;}
      if(comment==='block'){if(c==='*'&&next==='/'){comment=null;i++;}continue;}
      if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
      if(c==='/'&&next==='/'){comment='line';i++;continue;}
      if(c==='/'&&next==='*'){comment='block';i++;continue;}
      if(['"',"'",'`'].includes(c)){quote=c;continue;}
      if(c==='{'){braces++;opened=true;}else if(c==='}')braces--;
      if(c==='(')parens++;else if(c===')')parens--;
      if(c==='[')brackets++;else if(c===']')brackets--;
      if(!braces&&!parens&&!brackets&&(c===';'||kind==='interface'&&opened&&c==='}')){end=i+1;break;}
    }
    const before=source.slice(0,start),docStart=before.lastIndexOf('/**'),docEnd=before.lastIndexOf('*/');
    const doc=docStart>=0&&docEnd>docStart&&!before.slice(docEnd+2).trim()?before.slice(docStart):'';
    values.push({name:match[3],kind,text:doc+source.slice(start,end)});
  }
  return values;
}

const CODE_TYPES=`
/** Borrowed Synth instruments; methods use the upper editor's current sound. */
type SynthCodeFm = Omit<FMApi, 'setClock'> & {readonly id:string; dispose():void};
type SynthCodePsg = Omit<PSGApi, 'keyOn'|'keyOff'|'resetAll'> & {
  readonly id:string; readonly clock:number;
  /** Tone 0..2 or Noise 3, using the current Synth attenuation/envelope. */
  keyOn(channel:0|1|2|3):void;
  keyOff(channel:0|1|2|3):void;
  noteOff(channel:0|1|2|3):void;
  allNotesOff():void;
  /** Reset this PSG only. */
  resetAll():void;
  dispose():void;
};
type SynthCodePcm = Omit<PlaygroundRf5c164, 'setRootNote'|'setNote'|'noteOn'|'noteOff'> & {
  readonly id:string; readonly clock:number;
  /** Code-only software Root note override: note name or integer MIDI 0..127.
   * null inherits the upper PCM editor's Root note. Returns the effective MIDI
   * Root without retuning held notes or changing the editor/saved instrument.
   * Apply retains it; Stop or a new instrument clears it. Raw controls ignore it. */
  setRootNote(note:string|number|null):number;
  /** Software tuning from the upper PCM sample rate and effective Root note.
   * Accepts a note name or integer MIDI 0..127 (validated at runtime).
   * Returns the raw step (clamped to 1..65535) without starting the voice. After Code
   * loadSample/loadMemory, use raw controls until the editor sample returns. */
  setNote(channel:SynthCodePcmChannel,note:string|number):number;
  /** Set the software-tuned note and start the current editor sample.
   * Await when sample preparation may still be pending. */
  noteOn(channel:SynthCodePcmChannel,note:string|number):void|Promise<void>;
  /** Short software release; hard Stop belongs to allNotesOff. */
  noteOff(channel:SynthCodePcmChannel):void;
  allNotesOff():void;
};
type SynthCodePcmChannel = 0|1|2|3|4|5|6|7;
type SynthCodePwm = PlaygroundPWM32X & PlaygroundChipClock & {readonly id:string};
type SynthCodeSoundChipMap = {ym2612:SynthCodeFm; segapsg:SynthCodePsg; rf5c164:SynthCodePcm; pwm:SynthCodePwm};
type PlaygroundSelectedFmChannel = YM2612Channel;
type PlaygroundLivePrepareAPI = SynthCodeAPI;
declare const fm:SynthCodeFm;
declare function useSoundChip<Name extends keyof SynthCodeSoundChipMap>(name:Name):Promise<SynthCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function toPitch(note:string|number):{block:number;fnum:number};
declare function midiToNoteName(midi:number):string;
declare const pg:SynthCodeAPI;
`;

/** Narrow globals, clients and livePrepare/pg to the actual four-chip host.
 * Type bodies (FM parameters, effect controls, note lengths) remain shared. */
export function selectSynthCodeDeclarations(source) {
  const shared=declarations(source),custom=declarations(CODE_TYPES);
  const globals=shared.filter(value=>value.kind==='global'&&SYNTH_CODE_GLOBALS.includes(value.name));
  const overrides=new Map(custom.filter(value=>value.kind==='global').map(value=>[value.name,value]));
  const roots=globals.filter(value=>!overrides.has(value.name)).concat([...overrides.values()]);
  const types=new Map(shared.filter(value=>value.kind!=='global').map(value=>[value.name,value]));
  for(const value of custom.filter(value=>value.kind!=='global'))types.set(value.name,value);
  const pcm=types.get('PlaygroundRf5c164');
  if(!pcm)throw Error('Shared PCM declarations are missing.');
  types.set(pcm.name,{...pcm,text:pcm.text
    .replace('WAV/FLAC URL or encoded file bytes.','Local encoded audio bytes or decoded PCM channels.')
    .replace(/ch: number/g,'ch: SynthCodePcmChannel')
    .replace(/ \| string(?= \| Uint8Array)/g,'').replace(/ \| Blob/g,'')
    .replace(/^(  (?:setChannel|setPitch|keyOn|keyOff|writeRegister|reset)\([^\n]+\)): Promise<void>;/gm,'$1: void;')});
  // pg is the same globals object, not the full Playground rack/sample/MIDI API.
  const members=SYNTH_CODE_GLOBALS.map(name=>`${name}:typeof ${name};`).join('\n  ');
  types.set('SynthCodeAPI',{name:'SynthCodeAPI',kind:'interface',text:`interface SynthCodeAPI {\n  ${members}\n}`});
  const selected=new Map(),pending=roots.map(value=>value.text);
  while(pending.length) {
    const text=pending.pop().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
    for(const name of text.match(/[A-Za-z_$][\w$]*/g)??[]) {
      if(!types.has(name)||selected.has(name))continue;
      const value=types.get(name);selected.set(name,value);pending.push(value.text);
    }
  }
  return '// Synth Code: four shared instruments, no independent chip factory.\n'+
    [...selected.values(),...roots].map(value=>value.text).join('\n\n')+'\n';
}
