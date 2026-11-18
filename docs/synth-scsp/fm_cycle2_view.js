// SPDX-License-Identifier: BSD-3-Clause
// Fixed Cycle inputs; only direct output selection is authored here.
export function setupScspCycle2View({root=globalThis.document,onOutput,onError=()=>{}}) {
  const $=id=>root.getElementById(id),events=new AbortController();
  const option=$('scspCycle2Option'),controls=$('scspCycle2Controls');
  const target=$('scspCycle2Target'),input=$('scspCycle2Input'),output=$('scspCycle2Output');
  const hint=$('scspCycle2Hint'),depthLabel=$('scspOperatorDepthLabel');
  let selected=0,locked=true,disposed=false,revision=0,context='';
  output.addEventListener('change',()=>{
    const operator=selected,enabled=output.checked,token=revision;
    output.blur();
    if(disposed||locked||output.disabled)return;
    Promise.resolve().then(()=>{
      if(!disposed&&!locked&&token===revision)return onOutput(operator,enabled);
    }).catch(onError);
  },{signal:events.signal});
  return {
    update(state,{operator=0,readOnly=false}={}) {
      if(disposed)return;
      const fm=state.config.fm,active=state.config.mode==='fm2'&&fm.algorithm==='cycle2';
      const nextContext=JSON.stringify([state.config.mode,fm.algorithm,operator,Boolean(readOnly)]);
      if(nextContext!==context){context=nextContext;revision++;}
      selected=operator;
      const unused=operator!==0&&operator!==1;
      locked=readOnly||!active||unused;
      option.disabled=readOnly||state.config.mode!=='fm2';
      controls.hidden=!active;
      output.disabled=locked;
      output.checked=active&&!unused&&fm.cycle2.outputs.includes(operator);
      target.textContent=unused?'Cycle 2OP · choose A or B':`Cycle 2OP · operator ${'AB'[operator]}`;
      input.textContent=!active?'':unused?'Choose A or B':operator===0?'B · history average':'A · current';
      depthLabel.textContent=active&&!unused
        ? operator===0?'Depth · B → A (history)':'Depth · A → B'
        : 'Selected depth (MDL)';
      if(!active){hint.textContent='';return;}
      const outputs=fm.cycle2.outputs;
      const direct=outputs.length?`Direct output · ${outputs.map(index=>'AB'[index]).join(' + ')}`:'Direct outputs Off';
      const ratio=fm.ratios[1]/fm.ratios[0];
      const requested=Number.isFinite(ratio)?String(Number(ratio.toPrecision(6))):'—';
      const off=[0,1].filter(index=>(fm.depths?.[index]??fm.depth)===0);
      const offHint=off.length?` · Depth 0: ${off.map(index=>index===0?'B → A':'A → B').join(' + ')}`:'';
      hint.textContent=`${direct} · Requested B/A × ${requested}${offHint}`;
    },
    dispose(){if(disposed)return;disposed=true;revision++;events.abort();},
  };
}
