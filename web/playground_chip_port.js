/** AudioWorklet-side direct performance port. Main port only attaches/detaches.
 * The callback executes existing chip commands; it never asks the UI for audio work.
 */
export function createChipPortReceiver(apply, now = () => currentFrame / sampleRate) {
 let port=null, origin=null;
 const dispatch=command=>{
  if(command.type==='reset-sample-schedule'){origin=null;return;}
  if(command.type==='begin-sample-schedule'){origin ??= now()+Math.max(0,Number(command.lookaheadSeconds)||0);return;}
  if(command.type==='sample-writes'){
   origin ??= now();
   apply({type:'schedule-writes',entries:command.entries.map(({sample,...entry})=>({...entry,time:origin+sample/44100}))});return;
  }
  if(command.type==='sample-dac-bank'){
   origin ??= now();apply({type:'play-dac-bank',name:command.name,time:origin+command.sample/44100});return;
  }
  apply(command);
 };
 return data=>{
  if(data.type==='attach-chip-port'){
   port?.close();const next=data.port;port=next;origin=null;
   next.onmessage=({data:commands})=>{
    if(port!==next)return;
    if(!Array.isArray(commands)||commands.length>4096)return;
    for(const command of commands)dispatch(command);
   };
   next.start();return true;
  }
  if(data.type==='detach-chip-port'){port?.close();port=null;return true;}
  return false;
 };
}
