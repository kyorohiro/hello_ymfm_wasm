import {createPerformanceQueue} from './playground_performance_queue.js';

/** Shared optional reservation path for independent Playground chip processors.
 * Untagged standalone commands stay immediate. RPC setters acknowledge acceptance
 * while their sound changes wait for the reserved audio frame.
 */
/** @param {string} chip @param {any} command
 * @param {{psgLatch?:number,hucChannel?:number,opllRhythm?:number,wonderswanRegisters?:ArrayLike<number>}} [state] */
export function identifyPerformanceNote(chip,{method,type,args=[] ,register,value,channel,controlMask,psgRegister,port:registerPort=0},{psgLatch=0,hucChannel=0,opllRhythm=0,wonderswanRegisters}={}) {
  if(['reset','allNotesOff','panic'].includes(method))return {allOff:true};
  if(chip==='snes'&&['playTimeline','stopTimeline'].includes(method))return {key:'timeline',on:method==='playTimeline'};
  if(chip==='snes'&&['noteOn','keyOn','noteOff','keyOff'].includes(method))return {key:args[0],on:method==='noteOn'||method==='keyOn'};
  if(chip==='snes'&&method==='writeDsp'&&[0x4c,0x5c].includes(args[0]))return {events:Array.from({length:8},(_,key)=>key).filter(key=>args[1]&(1<<key)).map(key=>({key,on:args[0]===0x4c}))};
  if(chip==='dx7'&&(method==='noteOn'||method==='noteOff'))return {key:args[0],on:method==='noteOn'&&(args[1]??100)>0};
  if(chip==='rf5c164'&&(method==='keyOn'||method==='keyOff'))return {key:args[0],on:method==='keyOn'};
  if(chip==='nes'&&method==='setChannelEnabled')return {key:args[0],on:args[1]};
  if(chip==='nes'&&method==='writeRegister'&&args[0]===0x4083)return {key:5,on:!(args[1]&128)};
  if(chip==='gameboy'&&method==='writeRegister'){
    const [reg,v]=args,key=[4,9,14,19].indexOf(reg);
    if(key>=0&&(v&128))return {key,on:true};
    if([2,7,17].includes(reg)&&v===0)return {key:{2:0,7:1,17:3}[reg],on:false};
    if(reg===10&&!(v&128))return {key:2,on:false};
  }
  if(chip==='segapsg'&&method==='write') {
    const byte=args[0],latched=byte&128?(byte>>4)&7:Number.isInteger(psgRegister)?psgRegister:psgLatch;
    if(Number.isInteger(byte)&&byte>=0&&byte<=255&&(latched&1))return {key:latched>>1,on:(byte&15)!==15};
  }
  if(chip==='ay8910'){
    if(method==='forceKeyOff')return {key:args[0],on:false};
    const reg=type==='write'?register:method==='writeRegister'?args[0]:null,v=type==='write'?value:args[1];
    if(reg>=8&&reg<=10)return {key:reg-8,on:!!(v&31)};
  }
  if(chip==='ym2413'){
    if(method==='forceKeyOff')return {key:args[0],on:false};
    if(method==='forceRhythmOff')return {key:`rhythm:${args[0]}`,on:false};
    const reg=type==='write'?register:method==='writeRegister'?args[0]:null,v=type==='write'?value:args[1];
    if(reg>=0x20&&reg<=0x28)return {key:reg-0x20,on:!!(v&16)};
    if(reg===0x0e)return {events:Array.from({length:5},(_,index)=>({key:`rhythm:${index}`,on:!!(v&32)&&!!(v&(16>>index)),previous:!!(opllRhythm&32)&&!!(opllRhythm&(16>>index))})).filter(event=>event.on!==event.previous).map(({key,on})=>({key,on}))};
  }
  if(['ym3526','ym3812','y8950','ymf262'].includes(chip)){
    if(chip==='y8950'&&['forceAdpcmOff','auditionAdpcmOn','loadAdpcmMemory','clearAdpcmMemory'].includes(method))return 'adpcm';
    if(['forceRhythmOff','auditionRhythmOn'].includes(method))return [6,7,8,8,7][args[0]];
    if(method==='forceKeyOff')return {key:args[0],on:false};
    if(method==='forceRhythmOff')return {key:`rhythm:${args[0]}`,on:false};
    const reg=type==='write'?register:method==='writeRegister'?args[0]:null,v=type==='write'?value:args[1],bank=type==='write'?registerPort:args[2]??0;
    if(chip==='y8950'&&reg===7&&bank===0)return {key:'adpcm',on:(v&0xc1)===0x80};
    if(reg!==null&&(reg&255)>=0xb0&&(reg&255)<=0xb8)return {key:((reg>>8)||bank)*9+(reg&255)-0xb0,on:!!(v&32)};
    if(reg===0xbd)return {events:Array.from({length:5},(_,index)=>({key:`rhythm:${index}`,on:!!(v&32)&&!!(v&(16>>index))}))};
  }
  if(chip==='ym2151'&&method==='writeRegister'&&args[0]===8)return {key:args[1]&7,on:!!(args[1]&0x78)};
  if(chip==='ym2151'&&method==='forceKeyOff')return {key:args[0],on:false};
  if(chip==='wonderswan'){
    if(method==='keyOff')return {key:args[0],on:false};
    if(method==='writeRegister'&&args[0]===0x90){
      const mask=(controlMask??((wonderswanRegisters?.[0x10]??0)^args[1]))&15;
      const events=Array.from({length:4},(_,key)=>({key,on:!!(args[1]&(1<<key))})).filter(event=>mask&(1<<event.key));
      return events.length?{events}:null;
    }
  }
  if(chip==='huc6280'&&method==='writeRegister'&&args[0]===4)return {key:Number.isInteger(channel)?channel:hucChannel,on:!!(args[1]&128)};
  if(chip==='huc6280'&&method==='keyOff')return {key:args[0],on:false};
  if(chip==='okim6258'&&['play','stop','keyOff'].includes(method))return {key:0,on:method==='play'};
  if(chip==='okim6258'&&method==='writeRegister'&&args[0]===0)return {key:0,on:!(args[1]&1)&&!!(args[1]&2)};
  if(['ym2612','ym2203','ym2610','ym2610b','ym2608'].includes(chip)){
    const reg=type==='write'?register:method==='write'&&args.length>=3?args[1]:method==='writeRegister'?args[0]:null;
    const v=type==='write'?value:method==='write'?args[2]:args[1];
    const bank=type==='write'?registerPort:method==='write'?args[0]:args[2]??0;
    if(bank===0&&reg===0x28)return {key:[0,1,2,4,5,6].indexOf(v&7),on:!!(v&0xf0)};
    if(['ym2610','ym2610b'].includes(chip)){
      if(bank===0&&reg>=8&&reg<=10)return {key:`ssg:${reg-8}`,on:!!(v&31)};
      if(bank===0&&reg===0x10)return {key:'adpcmB',on:(v&0xc1)===0x80};
      if(bank===1&&reg===0)return {events:Array.from({length:6},(_,channel)=>channel).filter(channel=>v&(1<<channel)).map(channel=>({key:`adpcmA:${channel}`,on:!(v&128)}))};
    }
  }
  if(chip==='pwm'&&(method==='scheduleWrites'||(['write','writeRegister'].includes(method)&&args[0]>=2)))return {key:0,on:true};
  return null;
}
export function performanceNoteRelease(chip,key) {
  if(['ym2610','ym2610b'].includes(chip)){
    if(typeof key==='string'&&key.startsWith('ssg:'))return {method:'write',args:[0,8+Number(key.slice(4)),0]};
    if(typeof key==='string'&&key.startsWith('adpcmA:'))return {method:'write',args:[1,0,128|(1<<Number(key.slice(7)))]};
    if(key==='adpcmB')return {method:'write',args:[0,0x10,1]};
  }
  if(chip==='dx7')return {method:'noteOff',args:[key]};
  if(chip==='snes')return key==='timeline'?{method:'stopTimeline',args:[]}:{method:'keyOff',args:[key]};
  if(chip==='rf5c164')return {method:'keyOff',args:[key]};
  if(chip==='nes')return key===5?{method:'writeRegister',args:[0x4083,128]}:{method:'setChannelEnabled',args:[key,false]};
  if(chip==='gameboy')return {method:'writeRegister',args:[[2,7,10,17][key],0]};
  if(chip==='segapsg')return {method:'write',args:[0x9f|(key<<5)]};
  if(chip==='ym2151')return {method:'forceKeyOff',args:[key]};
  if(chip==='ay8910')return {method:'forceKeyOff',args:[key]};
  if(chip==='ym2413')return typeof key==='string'?{method:'forceRhythmOff',args:[Number(key.split(':')[1])]}:{method:'forceKeyOff',args:[key]};
  if(chip==='y8950'&&key==='adpcm')return {method:'writeRegister',args:[7,1,0]};
  if(['ym3526','ym3812','y8950','ymf262'].includes(chip))return typeof key==='string'?{method:'forceRhythmOff',args:[Number(key.split(':')[1])]}:{method:'forceKeyOff',args:[key]};
  if(chip==='wonderswan')return {method:'keyOff',args:[key]};
  if(chip==='huc6280')return {method:'keyOff',args:[key]};
  if(chip==='okim6258')return {method:'stop',args:[]};
  if(chip==='pwm')return {method:'reset',args:[]};
  return {method:'write',args:[0,0x28,[0,1,2,4,5,6][key]]};
}
/** Channel touched by native register commands, used only while an editor holds a key.
 * @param {string} chip @param {any} command
 * @param {{hucChannel?:number,psgLatch?:number,rfChannel?:number,wonderswanRegisters?:ArrayLike<number>}} [state] */
export function nativeVoiceChannel(chip,{method,type,args=[],channel,psgRegister},{hucChannel=0,psgLatch=0,rfChannel=0,wonderswanRegisters}={}) {
  if(chip==='rf5c164'){
    if(['setChannel','setPitch','keyOn','keyOff'].includes(method))return args[0];
    if(['clock','loadMemory'].includes(method)||type==='chip-clock')return 'all';
    if(method==='writeRegister'){
      if(args[0]<7)return rfChannel;
      if(args[0]===7&&!(args[1]&128))return 'all';
      // The active-low mask is merged per channel below, rather than blocking
      // another channel's note when one Keyboard voice is held.
      return null;
    }
  }
  if(chip==='segapsg'){
    if(method==='write'){const byte=args[0],latch=byte&128?byte>>4&7:Number.isInteger(psgRegister)?psgRegister:psgLatch;return latch>>1;}
    if(['allNotesOff','setStereo','clock'].includes(method)||type==='chip-clock')return 'all';
  }
  if(chip==='snes'){
    if(['setPreset','setChannel','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff'].includes(method))return args[0];
    if(['allNotesOff','prepareTimeline','playTimeline','stopTimeline'].includes(method))return 'all';
    if(method==='writeDsp'){const register=args[0];if([0x4c,0x5c].includes(register))return null;return (register&15)<8?register>>4:'all';}
  }
  if(chip==='dx7'){
    if(['noteOn','noteOff'].includes(method))return args[0];
    if(['setPreset','setOperator','setOperators','setFeedback','selectVoice','loadSysex','allNotesOff','panic'].includes(method))return 'all';
  }
  if(chip==='wonderswan'){
    if(method==='keyOff'||method==='setWaveform')return args[0];
    if(['allNotesOff','clock'].includes(method)||type==='chip-clock')return 'all';
    if(method==='writeMemory'){
      if(Number.isInteger(channel))return channel;
      const relative=args[0]-((wonderswanRegisters?.[15]??0)<<6);
      return relative>=0&&relative<64?Math.floor(relative/16):null;
    }
    if(method==='writeRegister'){
      const address=args[0];
      if(address>=0x80&&address<=0x87)return (address-0x80)>>1;
      if(address>=0x88&&address<=0x8b)return address-0x88;
      if(address===0x8c||address===0x8d)return 2;
      if([0x8e,0x92,0x93].includes(address))return 3;
      if(address===0x94)return 1;
      if(address===0x90)return null;
      return 'all';
    }
  }
  if(chip==='huc6280'){
    if(method==='keyOff'||method==='setWaveform')return args[0];
    if(method==='allNotesOff'||method==='clock'||type==='chip-clock')return 'all';
    if(method==='writeRegister'){
      const register=args[0];if([1,8,9].includes(register))return 'all';
      if(register>=2&&register<=7)return Number.isInteger(channel)?channel:hucChannel;
      if(register===0)return null;
    }
  }
  if(chip==='okim6258'&&['play','stop','keyOff','allNotesOff','reset','clock','loadMemory','writeRegister','setRepeat'].includes(method))return 0;
  if(chip==='ay8910'){
    if(['forceKeyOff','setRetainedLevel'].includes(method))return args[0];
    if(['allNotesOff','clock'].includes(method)||type==='chip-clock')return 'all';
    if(method==='writeRegister'){const register=args[0];if(register>=0&&register<=5)return register>>1;if(register>=8&&register<=10)return register-8;return 'all';}
  }
  if(chip==='ym2413'){
    if(['forceKeyOff','auditionKeyOn'].includes(method))return args[0];
    if(['forceRhythmOff','auditionRhythmOn'].includes(method))return [6,7,8,8,7][args[0]];
    if(['allNotesOff','clock'].includes(method)||type==='chip-clock')return 'all';
    if(method==='writeRegister'){
      const register=args[0];if(register>=0x10&&register<=0x18)return register-0x10;if(register>=0x20&&register<=0x28)return register-0x20;if(register>=0x30&&register<=0x38)return register-0x30;return 'all';
    }
  }
  if(['ym3526','ym3812','y8950','ymf262'].includes(chip)){
    if(['forceRhythmOff','auditionRhythmOn'].includes(method))return [6,7,8,8,7][args[0]];
    if(['forceKeyOff','auditionKeyOn'].includes(method))return args[0];
    if(['allNotesOff','clock'].includes(method)||type==='chip-clock')return 'all';
    if(method==='writeRegister'){
      const register=args[0]&255,bank=(args[0]>>8)||(args[2]??0);
      if(chip==='y8950'&&bank===0&&[7,9,10,11,12,13,14,15,16,17,18,21,22,23].includes(register))return 'adpcm';
      if(register>=0xa0&&register<=0xc8&&(register&15)<9)return bank*9+(register&15);
      if(register>=0x20&&register<=0xf5){const slots=[0,1,2,8,9,10,16,17,18],offset=register&31;for(let ch=0;ch<9;ch++)if(offset===slots[ch]||offset===slots[ch]+3)return bank*9+ch;}
      return 'all';
    }
  }
  if(chip==='ym2151') {
    if(method==='forceKeyOff'||method==='auditionKeyOn')return args[0];
    if(method==='allNotesOff')return 'all';
    if(method==='writeRegister') {
      const register=args[0];
      if(register===8)return args[1]&7;
      if(register>=0x20&&register<=255)return register&7;
      if(register>=0&&register<0x20)return 'all';
    }
  }
  if(chip==='gameboy'&&method==='writeRegister') {
    const r=args[0];
    if(r>=0&&r<=4)return 0;if(r>=5&&r<=9)return 1;
    if((r>=10&&r<=14)||(r>=32&&r<=47))return 2;
    if(r>=15&&r<=19)return 3;
    if([20,21,22].includes(r))return 'all';
  }
  if(chip==='nes') {
    if(method==='setChannelEnabled')return args[0];
    if(method==='writeRegister') {
      const r=args[0];if(r>=0x4000&&r<=0x4013)return Math.floor((r-0x4000)/4);
      if(r===0x4015)return 'all';if(r>=0x4023&&r<=0x408a)return 5;
    }
  }
  if(method==='reset')return 'all';return null;
}
export function createProcessorPerformance({apply,prepare,validate,onDiscard,onBlocked,chip,releaseNote,getPsgLatch,getPsgMode,getHucChannel,getRfChannel,getRfMask,getOpllRhythm,getAyRegisters,getOplRegisters,getWonderSwanRegisters,trackImmediateNotes=true,immediate = [],nowFrame = () => currentFrame,rate = sampleRate}) {
  const replies = new WeakMap(),ports = new WeakMap(),pendingRPC = new WeakMap(),immediateMethods = new Set(immediate);
  const owners=new Map(),auditions=new Map();
  let psgLatch=0,nesEnabled=0;
  const noteState={psgLatch:0};
  const chipName=()=>typeof chip==='function'?chip():chip;
  // Data bytes reuse the last register selected by any applied PSG writer.
  // A chip snapshot includes inspector writes that bypass this queue.
  function observePsgLatch(command) {
    if(chipName()==='nes'){
      if(command.method==='reset')nesEnabled=0;
      else if(command.method==='writeRegister'&&command.args[0]===0x4015)nesEnabled=command.args[1]&31;
      else if(command.method==='setChannelEnabled')nesEnabled=command.args[1]?nesEnabled|(1<<command.args[0]):nesEnabled&~(1<<command.args[0]);
    }
    if(chipName()!=='segapsg')return;
    if(command.method==='reset')psgLatch=0;
    else if(command.method==='allNotesOff')psgLatch=7;
    else if(command.method==='write'&&(command.args?.[0]&128))psgLatch=(command.args[0]>>4)&7;
  }
  function applyTracked(command,port,frame,metadata) {
    if(auditions.size&&['segapsg','snes','wonderswan'].includes(chipName())&&command.method==='allNotesOff'){
      for(let channel=0;channel<(chipName()==='snes'?8:4);channel++)if(!auditions.has(channel))applyTracked(performanceNoteRelease(chipName(),channel),port,frame);
      return true;
    }
    if(auditions.size&&chipName()==='dx7'&&['allNotesOff','panic'].includes(command.method)){
      for(const key of [...owners.keys()])if(!auditions.has(key))applyTracked({method:'noteOff',args:[key]},port,frame);
      return true;
    }
    // A script's global OPM release still stops its other voices while an editor
    // holds one channel. Keep that manual key and its owner until explicit Off.
    if(auditions.size&&chipName()==='ym2151'&&command.method==='allNotesOff'){
      for(let channel=0;channel<8;channel++)if(!auditions.has(channel))applyTracked({method:'forceKeyOff',args:[channel]},port,frame);
      return;
    }
    if(blockedByAudition(command,metadata)){onBlocked?.(command,port,metadata);return false;}
    command=protectNesEnable(command,metadata);
    command=protectSnesKeys(command,metadata);
    command=protectRfMask(command,metadata);
    command=protectOpllRhythm(command,metadata);
    command=protectAyMixer(command,metadata);
    command=protectY8950Control(command,metadata);
    command=protectWonderSwanControl(command,metadata);
    // Editor parameter patches retain a script's note owner even when a banked
    // control register repeats its existing gate bit. Triggers/releases do not.
    if(!metadata?.preserveOwner&&!note(command,port,metadata))return false;
    apply(command,port,frame,metadata); observePsgLatch(command);
    return true;
  }
  function blockedByAudition(command,metadata) {
    if(!auditions.size)return false;
    // PSG noise rate 3 uses tone channel 3's divider. A held noise key owns
    // that divider as well, while the tone channel's volume remains editable.
    if(chipName()==='segapsg'&&command.method==='write'&&auditions.has(3)&&(getPsgMode?.()&3)===3){
      const byte=command.args[0],register=byte&128?byte>>4&7:Number.isInteger(command.psgRegister)?command.psgRegister:getPsgLatch?.()??psgLatch;
      if(register===4&&auditions.get(3)!==metadata?.owner)return true;
    }
    if(chipName()==='wonderswan'&&command.method==='writeRegister'&&command.args[0]===0x90)return false;
    if(chipName()==='ay8910'&&command.method==='writeRegister'&&command.args[0]===7)return false;
    if(chipName()==='y8950'&&command.method==='writeRegister'&&command.args[0]===8&&getOplRegisters)return false;
    if(chipName()==='ym2413'&&command.method==='writeRegister'&&command.args[0]===0x0e&&!((command.args[1]^(getOpllRhythm?.()??0))&32))return false;
    const channel=nativeVoiceChannel(chipName(),command,{hucChannel:getHucChannel?.()??0,psgLatch:getPsgLatch?.()??psgLatch,rfChannel:getRfChannel?.()??0,wonderswanRegisters:getWonderSwanRegisters?.()});
    if(channel==='all'){
      if(chipName()==='nes'&&command.method==='writeRegister'&&command.args[0]===0x4015)return false;
      for(const owner of auditions.values())if(owner===metadata?.owner)return false;return true;
    }
    return auditions.has(channel)&&auditions.get(channel)!==metadata?.owner;
  }
  function protectNesEnable(command,metadata) {
    if(!auditions.size||chipName()!=='nes'||command.method!=='writeRegister'||command.args[0]!==0x4015)return command;
    let mask=0;for(const [channel,owner]of auditions)if(channel<5&&owner!==metadata?.owner)mask|=1<<channel;
    if(!mask)return command;
    return {...command,args:[0x4015,(command.args[1]&~mask)|(nesEnabled&mask)]};
  }
  function protectSnesKeys(command,metadata){
    if(!auditions.size||chipName()!=='snes'||command.method!=='writeDsp'||![0x4c,0x5c].includes(command.args[0]))return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=1<<channel;
    return {...command,args:[command.args[0],command.args[1]&~mask]};
  }
  function protectRfMask(command,metadata){
    if(!auditions.size||chipName()!=='rf5c164'||command.method!=='writeRegister'||command.args[0]!==8)return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=1<<channel;
    return {...command,args:[8,(command.args[1]&~mask)|((getRfMask?.()??255)&mask)]};
  }
  function protectOpllRhythm(command,metadata){
    if(!auditions.size||chipName()!=='ym2413'||command.method!=='writeRegister'||command.args[0]!==0x0e)return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=channel===6?16:channel===7?9:channel===8?6:0;
    return {...command,args:[0x0e,(command.args[1]&~mask)|((getOpllRhythm?.()??0)&mask)]};
  }
  function protectAyMixer(command,metadata){
    if(!auditions.size||chipName()!=='ay8910'||command.method!=='writeRegister'||command.args[0]!==7)return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=(1<<channel)|(8<<channel);
    return {...command,args:[7,(command.args[1]&~mask)|((getAyRegisters?.()?.[7]??0x38)&mask)]};
  }
  function protectY8950Control(command,metadata){
    if(chipName()!=='y8950'||command.method!=='writeRegister'||command.args[0]!==8||!getOplRegisters)return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=channel==='adpcm'?0x3f:0xc0;
    if(!mask)return command;return {...command,args:[8,(command.args[1]&~mask)|(getOplRegisters()[8]&mask),...(command.args.length>2?[command.args[2]]:[])]};
  }
  function protectWonderSwanControl(command,metadata){
    if(!auditions.size||chipName()!=='wonderswan'||command.method!=='writeRegister'||command.args[0]!==0x90)return command;
    let mask=0;for(const [channel,owner]of auditions)if(owner!==metadata?.owner)mask|=(1<<channel)|([0,0x20,0x40,0x80][channel]??0);
    const controlMask=(command.controlMask??255)&~mask;
    return {...command,controlMask,args:[0x90,(command.args[1]&controlMask)|((getWonderSwanRegisters?.()?.[16]??0)&~controlMask)]};
  }
  function manualNoteOwner(key,metadata){
    const physical=chipName()==='ym2413'&&typeof key==='string'&&key.startsWith('rhythm:')?[6,7,8,8,7][Number(key.slice(7))]:key;
    return auditions.has(physical)&&auditions.get(physical)===metadata?.owner;
  }
  function note(command,port,metadata) {
    noteState.psgLatch=getPsgLatch?.()??psgLatch;
    noteState.hucChannel=getHucChannel?.()??0;
    noteState.opllRhythm=getOpllRhythm?.()??0;
    noteState.wonderswanRegisters=getWonderSwanRegisters?.();
    const event=identifyPerformanceNote(chipName(),command,noteState);
    if(!event)return true;
    if(event.allOff){owners.clear();return true;}
    if(event.events){
      if(event.events.some(event=>!event.on&&metadata&&owners.has(event.key)&&owners.get(event.key).owner!==metadata.owner&&!manualNoteOwner(event.key,metadata)))return false;
      for(const entry of event.events){
        if(entry.on)owners.set(entry.key,{owner:metadata?.owner??null,port});else owners.delete(entry.key);
      }
      return true;
    }
    const previous=owners.get(event.key);
    // A newly acquired editor lease may release the old physical key before
    // retriggering it. Other owners still cannot send a stale release.
    const manualOwner=manualNoteOwner(event.key,metadata);
    if(!event.on&&metadata&&previous&&previous.owner!==metadata.owner&&!manualOwner)return false;
    if(event.on)owners.set(event.key,{owner:metadata?.owner??null,port});else owners.delete(event.key);
    return true;
  }
  const queue = createPerformanceQueue({sampleRate:rate,nowFrame,validate,
    onDiscard(command,metadata) {
      const pending=pendingRPC.get(command);
      if(pending){pendingRPC.delete(command);pending.postMessage({id:command.id,error:'Performance command cancelled',name:'AbortError'});}
      onDiscard?.(command,metadata);
    },
    apply(command,reply,frame,metadata) {pendingRPC.delete(command);const port=ports.get(reply);applyTracked(command,port,frame,metadata);},
    onCancelOwner(owner) {
      for(const [key,entry]of owners)if(entry.owner===owner){owners.delete(key);applyTracked(releaseNote?releaseNote(key):performanceNoteRelease(chipName(),key),entry.port);}
    },
    prepare(command,reply,performance) {
      const port = ports.get(reply);
      let deferred;
      if (prepare) deferred=prepare(command,port,performance);
      else if (immediateMethods.has(command.method)) {
        if(chipName()==='rf5c164'){
          if(!applyTracked(command,port,nowFrame())&&command.id!==undefined)port.postMessage({id:command.id,value:true});
        }else apply(command,port);
        return null;
      }
      else if (command.id === undefined) deferred=command;
      else {const {id,...data}=command;port.postMessage({id,value:true});deferred=data;}
      if(deferred?.id!==undefined)pendingRPC.set(deferred,port);
      return deferred;
    },
  });
  // Browsers may replace their output Float32Array every quantum. Prefix views
  // of owned scratch buffers remain stable across those replacements and every
  // possible sample offset; segment rendering does not allocate new subviews.
  let capacity=0,leftViews,rightViews;
  function reserve(frames) {
    if(frames<=capacity)return;
    capacity=frames;
    const left=new Float32Array(frames),right=new Float32Array(frames);
    leftViews=Array.from({length:frames+1},(_,count)=>left.subarray(0,count));
    rightViews=Array.from({length:frames+1},(_,count)=>right.subarray(0,count));
  }
  reserve(128);
  return {
    receive(data,port) {
      // Editor audition writes use applyImmediate, so ordinary Main commands and
      // previously reserved Worker commands cannot replace a held manual note.
      if(!data?.performance&&auditions.size&&((['ym2151','segapsg','snes','wonderswan'].includes(chipName())&&data?.method==='allNotesOff')||
          (chipName()==='dx7'&&['allNotesOff','panic'].includes(data?.method)))){
        applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;
      }
      if(!data?.performance&&blockedByAudition(data)){
        if(onBlocked)onBlocked(data,port);else if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;
      }
      if(!data?.performance&&auditions.size&&chipName()==='wonderswan'&&data?.method==='writeRegister'&&data.args[0]===0x90){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      if(!data?.performance&&auditions.size&&chipName()==='nes'&&data?.method==='writeRegister'&&data.args[0]===0x4015){applyTracked(data,port,nowFrame());return true;}
      if(!data?.performance&&auditions.size&&chipName()==='snes'&&data?.method==='writeDsp'&&[0x4c,0x5c].includes(data.args[0])){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      if(!data?.performance&&auditions.size&&chipName()==='rf5c164'&&data?.method==='writeRegister'&&data.args[0]===8){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      if(!data?.performance&&auditions.size&&chipName()==='ay8910'&&data?.method==='writeRegister'&&data.args[0]===7){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      if(!data?.performance&&auditions.size&&chipName()==='y8950'&&data?.method==='writeRegister'&&data.args[0]===8){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      if(!data?.performance&&auditions.size&&chipName()==='ym2413'&&data?.method==='writeRegister'&&data.args[0]===0x0e){applyTracked(data,port,nowFrame());if(data.id!==undefined)port.postMessage({id:data.id,value:true});return true;}
      let reply=replies.get(port);
      if (!reply) {reply=message=>port.postMessage(message);replies.set(port,reply);ports.set(reply,port);}
      if(data?.performance&&data.commands?.some(command=>command.id!==undefined)){
        reply=message=>{
          port.postMessage(message);
          if(message.type==='performance-error')for(const command of data.commands)if(command.id!==undefined)port.postMessage({id:command.id,error:message.error});
        };
        ports.set(reply,port);
      }
      const handled=queue.receive(data,reply);
      if(!handled&&trackImmediateNotes&&note(data,port))observePsgLatch(data);
      return handled;
    },
    render(left,right,render) {
      let offset=0;
      const start=nowFrame(),end=start+left.length;
      while(offset<left.length) {
        queue.advance(start+offset);
        const next=Math.min(end,queue.nextFrame());
        const count=Math.min(left.length-offset,Math.max(1,next-start-offset));
        if(offset===0&&count===left.length)render(left,right,start+offset);
        else {
          reserve(count);
          const l=leftViews[count],r=rightViews[count];l.fill(0);r.fill(0);
          render(l,r,start+offset);left.set(l,offset);right.set(r,offset);
        }
        offset+=count;
      }
    },
    beginAudition(channel,owner){auditions.set(channel,owner);},
    endAudition(channel,owner){if(auditions.get(channel)===owner)auditions.delete(channel);},
    applyImmediate(command,port,metadata){return applyTracked(command,port,nowFrame(),metadata);},
    clear(){queue.clear();owners.clear();auditions.clear();},
    getStats:queue.getStats,
  };
}
