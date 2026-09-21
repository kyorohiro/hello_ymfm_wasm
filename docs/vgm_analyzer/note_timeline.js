// Compact, sorted pitch intervals, independent of the live wall-clock history.
export function packTimeline(notes) {
  const rows=[];
  for(let i=0;i<notes.length;i++){
    let n=notes[i], next=notes[i+1];
    if(n.freshOnset && n.endReason==='pitch' && n.end-n.start<=8 &&
       next?.key===n.key && next.start===n.end && Number.isFinite(next.midi)){
      n={...next,start:n.start};i++;
    }
    if(!Number.isFinite(n.midi) || n.end<=n.start)continue;
    rows.push(n.start,n.end,n.midi,n.key);
  }
  return Float64Array.from(rows);
}
// Return only the visible intervals. A density budget bounds drawing work.
const endIndexes=new WeakMap();
export function timelineWindow(data,start,end,limit=16000) {
  let ends=endIndexes.get(data);
  if(!ends){ends=new Float64Array(data.length/4);for(let i=0;i<ends.length;i++)ends[i]=Math.max(i?ends[i-1]:0,data[i*4+1]);endIndexes.set(data,ends);}
  let lo=0,hi=ends.length;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(ends[mid]<start)lo=mid+1;else hi=mid;}
  const rows=[];
  for(let i=lo;i<data.length/4 && data[i*4]<=end;i++){
    if(data[i*4+1]<start)continue;
    if(rows.length>=limit)return {rows,dense:true};
    rows.push([data[i*4],data[i*4+1],data[i*4+2],data[i*4+3]]);
  }
  return {rows,dense:false};
}
export function timelineScrollWidth(duration, pixelsPerSecond, viewport) {
  return Math.max(viewport,Math.min(8000000,duration/44100*pixelsPerSecond));
}

export function timelinePlaybackPosition(sample,duration,loopSamples=0,looping=false) {
  if(looping && loopSamples>0 && loopSamples<=duration && sample>=duration)
    return duration-loopSamples+(sample-duration)%loopSamples;
  return Math.max(0,Math.min(duration,sample));
}
