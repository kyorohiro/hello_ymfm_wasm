// SPDX-License-Identifier: BSD-3-Clause
// MDL belongs to the receiving operator; X/Y share that hardware depth.
export function setupScspFmDepthView({root=globalThis.document,onDepth,onError=()=>{}}) {
  const input=root.getElementById('operatorDepth'),summary=root.getElementById('scspFmDepthSummary');
  const events=new AbortController();
  let selected=0,count=0,locked=true,disposed=false;
  input.addEventListener('change',()=>{
    const value=Number(input.value),operator=selected,operatorCount=count;
    input.blur();
    if(disposed||locked||input.disabled)return;
    Promise.resolve().then(()=>{if(!disposed&&!locked)return onDepth(operator,value,operatorCount);}).catch(onError);
  },{signal:events.signal});
  return {
    update(state,{operator=0,readOnly=false}={}) {
      if(disposed)return;
      selected=operator;count=Number(state.config.mode.slice(2));
      locked=readOnly||![2,4,6].includes(count)||operator>=count;
      input.disabled=locked;
      if(root.activeElement!==input&&!input.classList.contains('is-dragging'))
        input.value=String(state.config.fm.depths?.[operator]??state.config.fm.depth);
      summary.hidden=!state.config.fm.depths||state.config.mode==='pcm';
      summary.textContent=summary.hidden?'':`Per-OP · ${state.config.fm.depths.slice(0,count).map((value,index)=>`${'ABCDEF'[index]} ${value}`).join(' · ')}`;
    },
    dispose(){disposed=true;events.abort();},
  };
}
