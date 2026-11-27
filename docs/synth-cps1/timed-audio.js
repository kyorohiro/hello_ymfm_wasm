// SPDX-License-Identifier: BSD-3-Clause
import {createRegisterTimedProcessor} from '../js/register_timed_processor.js';
import {planTools} from './timed-plan.js';

export function createChipTimeline(chip,write,release,port){
  const timeline=createRegisterTimedProcessor({
    nowFrame:()=>currentFrame,sampleRate,write,release,defaultOwner:chip,
    checkAvailable:()=>{},reportError:({message})=>port.postMessage({scheduleFailure:message}),
  },planTools(chip));
  return {
    render:timeline.render,
    receive(data,replyPort=port){
      if(data.clearTimeline){timeline.clear();return true;}
      if(!data.timedRequest)return false;
      const reply={timedReply:data.timedRequest};
      try{reply.value=timeline.request(data.payload);}catch(error){reply.failure=error.message;}
      replyPort.postMessage(reply);return true;
    },
  };
}
