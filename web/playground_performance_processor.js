import {createPerformanceQueue} from './playground_performance_queue.js';

/** Shared optional reservation path for independent Playground chip processors.
 * Untagged standalone commands stay immediate. RPC setters acknowledge acceptance
 * while their sound changes wait for the reserved audio frame.
 */
export function identifyPerformanceNote(chip,{method,type,args=[] ,register,value}) {
  if(['reset','allNotesOff','panic'].includes(method))return {allOff:true};
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
  if(chip==='segapsg'&&method==='write'&&(args[0]&0x90)===0x90)return {key:(args[0]>>5)&3,on:(args[0]&15)!==15};
  if(chip==='ym2151'&&method==='writeRegister'&&args[0]===8)return {key:args[1]&7,on:!!(args[1]&0x78)};
  if(['ym2612','ym2203','ym2610','ym2608'].includes(chip)){
    const reg=type==='write'?register:method==='write'&&args.length>=3?args[1]:method==='writeRegister'?args[0]:null;
    const v=type==='write'?value:method==='write'?args[2]:args[1];
    if(reg===0x28)return {key:[0,1,2,4,5,6].indexOf(v&7),on:!!(v&0xf0)};
  }
  if(chip==='pwm'&&(method==='scheduleWrites'||(['write','writeRegister'].includes(method)&&args[0]>=2)))return {key:0,on:true};
  return null;
}
export function performanceNoteRelease(chip,key) {
  if(chip==='dx7')return {method:'noteOff',args:[key]};
  if(chip==='snes')return {method:'keyOff',args:[key]};
  if(chip==='rf5c164')return {method:'keyOff',args:[key]};
  if(chip==='nes')return key===5?{method:'writeRegister',args:[0x4083,128]}:{method:'setChannelEnabled',args:[key,false]};
  if(chip==='gameboy')return {method:'writeRegister',args:[[2,7,10,17][key],0]};
  if(chip==='segapsg')return {method:'write',args:[0x9f|(key<<5)]};
  if(chip==='ym2151')return {method:'writeRegister',args:[8,key]};
  if(chip==='pwm')return {method:'reset',args:[]};
  return {method:'write',args:[0,0x28,[0,1,2,4,5,6][key]]};
}
export function createProcessorPerformance({apply,prepare,validate,onDiscard,chip,releaseNote,immediate = [],nowFrame = () => currentFrame,rate = sampleRate}) {
  const replies = new WeakMap(),ports = new WeakMap(),pendingRPC = new WeakMap(),immediateMethods = new Set(immediate);
  const owners=new Map();
  function note(command,port,metadata) {
    const event=identifyPerformanceNote(typeof chip==='function'?chip():chip,command);
    if(!event)return true;
    if(event.allOff){owners.clear();return true;}
    if(event.events){
      if(event.events.some(event=>!event.on&&metadata&&owners.has(event.key)&&owners.get(event.key).owner!==metadata.owner))return false;
      for(const entry of event.events){
        if(entry.on)owners.set(entry.key,{owner:metadata?.owner??null,port});else owners.delete(entry.key);
      }
      return true;
    }
    const previous=owners.get(event.key);
    if(!event.on&&metadata&&previous&&previous.owner!==metadata.owner)return false;
    if(event.on)owners.set(event.key,{owner:metadata?.owner??null,port});else owners.delete(event.key);
    return true;
  }
  const queue = createPerformanceQueue({sampleRate:rate,nowFrame,validate,
    onDiscard(command,metadata) {
      const pending=pendingRPC.get(command);
      if(pending){pendingRPC.delete(command);pending.postMessage({id:command.id,error:'Performance command cancelled'});}
      onDiscard?.(command,metadata);
    },
    apply(command,reply,frame,metadata) {pendingRPC.delete(command);const port=ports.get(reply);if(note(command,port,metadata))apply(command,port,frame,metadata);},
    onCancelOwner(owner) {
      for(const [key,entry]of owners)if(entry.owner===owner){owners.delete(key);apply(releaseNote?releaseNote(key):performanceNoteRelease(typeof chip==='function'?chip():chip,key),entry.port);}
    },
    prepare(command,reply,performance) {
      const port = ports.get(reply);
      let deferred;
      if (prepare) deferred=prepare(command,port,performance);
      else if (immediateMethods.has(command.method)) {apply(command,port);return null;}
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
      if(!handled)note(data,port);
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
    clear:queue.clear,
    getStats:queue.getStats,
  };
}
