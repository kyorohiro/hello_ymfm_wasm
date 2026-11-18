// SPDX-License-Identifier: BSD-3-Clause
// Logical operators stay distinct from their allocated physical SCSP slots.
export function setupScspCustomFmView({root=globalThis.document,onInput,onOutput,onError=()=>{}}) {
  const $=id=>root.getElementById(id),events=new AbortController();
  let selected=0,locked=false,disposed=false;
  const input=$('scspCustomFmInput'),output=$('scspCustomFmOutput');
  const edit=callback=>{
    if(disposed||locked||selected>1)return;
    const operator=selected;
    Promise.resolve().then(()=>{if(!disposed&&!locked)return callback(operator);}).catch(onError);
  };
  input.addEventListener('change',()=>{
    const source=input.value===''?null:Number(input.value);input.blur();
    edit(operator=>onInput(operator,source));
  },{signal:events.signal});
  output.addEventListener('change',()=>{
    const enabled=output.checked;output.blur();
    edit(operator=>onOutput(operator,enabled));
  },{signal:events.signal});
  return {
    update(state,{operator=0,readOnly=false}={}) {
      if(disposed)return;
      selected=operator;
      const active=state.config.mode==='fm2'&&state.config.fm.algorithm==='custom';
      locked=readOnly||!active;
      $('scspCustomFmControls').hidden=!active;
      $('scspCustomFmOption').disabled=readOnly||state.config.mode!=='fm2';
      const unused=operator>1;
      $('scspCustomFmTarget').textContent=unused?'Custom 2OP · choose A or B':`Custom · operator ${'ABCDEF'[operator]}`;
      input.disabled=output.disabled=locked||unused;
      for(const option of input.options)option.disabled=option.value===String(operator);
      if(!active||unused)return;
      const graph=state.config.fm.custom;
      input.value=graph.inputs[operator].length?String(graph.inputs[operator][0]):'';
      output.checked=graph.outputs.includes(operator);
      $('scspCustomFmHint').textContent=graph.outputs.length
        ? `Direct output · ${graph.outputs.map(index=>'AB'[index]).join(' + ')}`
        : 'Direct outputs Off · use an Output checkbox or an explicit DSP Send.';
    },
    dispose(){disposed=true;events.abort();},
  };
}
