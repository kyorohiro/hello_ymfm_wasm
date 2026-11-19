// SPDX-License-Identifier: BSD-3-Clause
// Session-only retained snapshots. Do not serialize this stack into a Cassette.
export const SPU_HISTORY_ENTRIES=20,SPU_HISTORY_BYTES=32*1024*1024;
function retainedBytes(value,limit){
  const pending=[value],seen=new Set();let total=0;
  while(pending.length&&total<=limit){
    const item=pending.pop();
    if(typeof item==='string'){total+=item.length*2;continue;}
    if(typeof item==='number'){total+=8;continue;}
    if(typeof item==='boolean'){total+=4;continue;}
    if(!item||typeof item!=='object'||seen.has(item))continue;
    seen.add(item);total+=64;
    if(ArrayBuffer.isView(item)){total+=item.byteLength;continue;}
    if(item instanceof ArrayBuffer){total+=item.byteLength;continue;}
    if(Array.isArray(item)&&item.every(value=>typeof value==='number')){total+=item.length*8;continue;}
    for(const [key,value]of Object.entries(item)){total+=key.length*2+8;pending.push(value);}
  }
  return total;
}
export function createSpuFileHistory({maxEntries=SPU_HISTORY_ENTRIES,maxBytes=SPU_HISTORY_BYTES}={}){
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw TypeError('Invalid SPU history bounds');
  const entries=[];let bytes=0;
  return{
    // The caller supplies an independent immutable snapshot, never live files.
    push(value){
      const size=retainedBytes(value,maxBytes);
      if(size>maxBytes){entries.length=0;bytes=0;return false;}
      entries.push({value,size});bytes+=size;
      while(entries.length>maxEntries||bytes>maxBytes)bytes-=entries.shift().size;
      return true;
    },
    peek:()=>entries.at(-1)?.value??null,
    pop(){const entry=entries.pop();if(entry)bytes-=entry.size;return entry?.value??null;},
    read:()=>({entries:entries.length,bytes,maxEntries,maxBytes}),
    clear(){entries.length=0;bytes=0;},
  };
}
