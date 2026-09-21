/** Display/export grouping. Source channels and note objects are never changed. */
export const scoreChannelId=ch=>ch.id??ch.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function groupScoreChannels(channels,groups=[]) {
  if(!Array.isArray(groups))throw new Error('groups must be an array');
  const known=new Map(channels.map(ch=>[scoreChannelId(ch),ch]));
  if(known.size!==channels.length)throw new Error('Ambiguous physical channel IDs');
  const used=new Set(),ids=new Set();
  const grouped=groups.map(g=>{
    if(!g||typeof g.id!=='string'||!g.id||ids.has(g.id)||known.has(g.id)||typeof g.name!=='string'||!g.name.trim()||!Array.isArray(g.channels)||!g.channels.length)throw new Error('Invalid or duplicate group');
    ids.add(g.id);
    const notes=[];
    for(const id of g.channels){
      if(!known.has(id)||used.has(id))throw new Error('Unknown or multiply grouped channel: '+id);
      used.add(id);
      for(const n of known.get(id).notes)notes.push({...n,sourceChannel:id,sourceKey:n.key,key:JSON.stringify([id,n.key])});
    }
    notes.sort((a,b)=>a.start-b.start||a.end-b.end);
    return {id:g.id,name:g.name,sourceChannels:[...g.channels],notes};
  });
  return [...grouped,...channels.filter(ch=>!used.has(scoreChannelId(ch)))];
}
/** Deterministic interval partitioning, not melody/voice inference. Partition on
 * the export grid so rounding cannot create new overlaps within a voice. */
export function scoreVoices(channel,bpm) {
  if(!channel.sourceChannels)return [channel.notes];
  const tick=s=>Math.round(s*bpm*4/(44100*60));
  const voices=[],ends=[];
  for(const n of channel.notes){
    if(!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<n.start)throw new Error('Invalid note time');
    const start=tick(n.start),end=tick(n.end);
    let i=ends.findIndex(t=>t<=start);if(i<0){i=voices.length;voices.push([]);}
    voices[i].push(n);ends[i]=end;
  }
  return voices.length?voices:[[]];
}
export function parseScoreGroups(values=[],all=false,channels=[]) {
  if(all&&values.length)throw new Error('Use --group or --merge-all, not both');
  if(all)return [{id:'group-all',name:'All channels',channels:channels.map(scoreChannelId)}];
  return values.map((v,i)=>{const at=v.indexOf('=');if(at<=0||at===v.length-1)throw new Error('Use --group Name=channel-id,channel-id');return {id:'group-'+(i+1),name:v.slice(0,at).trim(),channels:v.slice(at+1).split(',').map(x=>x.trim())};});
}
/** Selecting any member includes the complete group; unselected groups are omitted. */
export function groupSelectedScoreChannels(channels,selected,groups=[]) {
  groupScoreChannels(channels,groups); // validate against the complete source first
  const ids=new Set(selected.map(scoreChannelId));
  const included=groups.filter(g=>g.channels.some(id=>ids.has(id)));
  for(const g of included)for(const id of g.channels)ids.add(id);
  return groupScoreChannels(channels.filter(ch=>ids.has(scoreChannelId(ch))),included);
}
