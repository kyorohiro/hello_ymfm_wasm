/** AudioWorklet-side direct performance port. Main port only attaches/detaches.
 * The callback executes existing chip commands; it never asks the UI for audio work.
 */
export function createChipPortReceiver(apply) {
 let port=null;
 return data=>{
  if(data.type==='attach-chip-port'){
   port?.close();const next=data.port;port=next;
   next.onmessage=({data:commands})=>{
    if(port!==next)return;
    if(!Array.isArray(commands)||commands.length>4096)return;
    for(const command of commands)apply(command);
   };
   next.start();return true;
  }
  if(data.type==='detach-chip-port'){port?.close();port=null;return true;}
  return false;
 };
}
