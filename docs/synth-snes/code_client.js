// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';
const cancelled=()=>new DOMException('S-DSP Code session stopped','AbortError');
let sequence=0;
/** Synth performance lanes share the keyboard's allocator and current patch.
 * Lanes are not raw DSP channels: PMON still allocates adjacent voice pairs.
 * Retiring a client releases only its own note identities, never manual keys. */
export function createSnesCodeClient({command,isCurrent=()=>true,onActivity=()=>{}}={}) {
  if(typeof command!=='function')throw TypeError('S-DSP Code needs a command callback');
  const session=++sequence,notes=new Map();let closed=false,queue=Promise.resolve();
  const check=()=>{if(closed||!isCurrent())throw cancelled();};
  const lane=value=>{if(!Number.isInteger(value)||value<0||value>7)throw RangeError('S-DSP performance lane must be 0..7');};
  const enqueue=action=>{const result=queue.then(action);queue=result.catch(()=>{});return result;};
  async function releaseAll(){
    const ids=[...notes.values()];notes.clear();
    for(const id of ids)await command('noteOff',[id]);
    onActivity();
  }
  const client={id:`snes:synth:${session}`,chip:'snes',
    noteOn(channel,note){
      check();lane(channel);
      const hz=noteToHz(note),midi=Math.round(69+12*Math.log2(hz/440));
      if(!Number.isFinite(hz)||hz<=0||midi<0||midi>127||typeof note==='number'&&!Number.isInteger(note))throw RangeError('Use a note name or integer MIDI 0..127');
      return enqueue(async()=>{
        check();const previous=notes.get(channel);if(previous)await command('noteOff',[previous]);check();
        const id=`sdsp-code:${session}:${++sequence}`;
        const result=await command('noteOn',[id,midi]);
        notes.set(channel,id);
        // Stop may arrive during an acknowledgement; cleanup is queued behind us.
        if(result?.stolenId)for(const [lane,owner]of notes)if(owner===result.stolenId)notes.delete(lane);
        check();onActivity(result);return result;
      });
    },
    noteOff(channel){check();lane(channel);return enqueue(async()=>{check();const id=notes.get(channel);notes.delete(channel);if(id)await command('noteOff',[id]);onActivity();});},
    getState(){check();return enqueue(async()=>{check();return command('read');});},
    allNotesOff(){check();return enqueue(releaseAll);},
    dispose(){if(closed)return queue;closed=true;return enqueue(releaseAll);},
  };
  return client;
}
