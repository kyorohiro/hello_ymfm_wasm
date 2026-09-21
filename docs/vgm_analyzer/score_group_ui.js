import {groupScoreChannels,scoreChannelId} from './score_groups.js';
// Per loaded source, session-only. Loading another buffer never reuses assignments.
const state=new WeakMap();
export const getScoreGroups=source=>source&&state.get(source)||[];
export function mountScoreGroups({getTrack,getAnalysis,onChange,setStatus}) {
  const dialog=document.getElementById('scoreGroupDialog'),list=dialog.querySelector('[data-channels]'),rows=dialog.querySelector('[data-groups]'),name=dialog.querySelector('[data-name]');
  let source,channels=[],editing=null,nextId=0;
  function draw(){
    rows.replaceChildren();
    for(const g of getScoreGroups(source)){
      const row=document.createElement('div'),label=document.createElement('span');
      label.textContent=g.name+' — '+g.channels.join(', ')+' ';row.append(label);
      for(const action of ['Edit','Remove']){const b=document.createElement('button');b.type='button';b.textContent=action;b.onclick=safe(()=>{
        if(action==='Edit'){editing=g.id;name.value=g.name;for(const input of list.querySelectorAll('input'))input.checked=g.channels.includes(input.value);}
        else commit(getScoreGroups(source).filter(x=>x.id!==g.id));
      });row.append(b);}rows.append(row);
    }
  }
  function commit(groups){
    if(source!==getTrack().buffer)throw new Error('Track changed; reopen Groups');
    groupScoreChannels(channels,groups);state.set(source,groups);editing=null;name.value='';
    for(const input of list.querySelectorAll('input'))input.checked=false;
    dialog.querySelector('[data-error]').textContent='';draw();onChange();
  }
  const safe=fn=>()=>{try{fn();}catch(e){setStatus(e.message);dialog.querySelector('[data-error]').textContent=e.message;}};
  for(const b of document.querySelectorAll('[data-score-groups]'))b.addEventListener('click',safe(()=>{
    const track=getTrack();if(!track.buffer)throw new Error('Load a track first');
    source=track.buffer;channels=getAnalysis(source).channels;editing=null;name.value='';list.replaceChildren();
    dialog.querySelector('[data-error]').textContent='';
    for(const ch of channels){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=scoreChannelId(ch);label.style.display='block';label.append(input,document.createTextNode(' '+ch.name));list.append(label);}
    draw();dialog.showModal();
  }));
  dialog.querySelector('[data-save]').onclick=safe(()=>{
    const selected=[...list.querySelectorAll('input:checked')].map(i=>i.value);
    const groups=getScoreGroups(source).filter(g=>g.id!==editing);
    commit([...groups,{id:editing??'group-ui-'+(++nextId),name:name.value.trim()||'Group '+nextId,channels:selected}]);
  });
  dialog.querySelector('[data-all]').onclick=safe(()=>commit([{id:'group-all',name:'All channels',channels:channels.map(scoreChannelId)}]));
  dialog.querySelector('[data-clear]').onclick=safe(()=>commit([]));
}
