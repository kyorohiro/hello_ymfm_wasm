// SPDX-License-Identifier: BSD-3-Clause
// Logical operators stay distinct from their allocated physical SCSP slots.
export function setupScspCustomFmView({root=globalThis.document,onInput,onOutput,onError=()=>{}}) {
  const $=id=>root.getElementById(id),events=new AbortController();
  let selected=0,count=0,locked=false,disposed=false;
  const input=$('scspCustomFmInput'),inputY=$('scspCustomFmInputY'),output=$('scspCustomFmOutput');
  const edit=callback=>{
    if(disposed||locked||selected>=count)return;
    const operator=selected,operatorCount=count;
    Promise.resolve().then(()=>{if(!disposed&&!locked)return callback(operator,operatorCount);}).catch(onError);
  };
  [input,inputY].forEach((control,port)=>control.addEventListener('change',()=>{
    const source=control.value===''?null:Number(control.value);control.blur();
    if(!control.disabled)edit((operator,count)=>onInput(operator,source,port,count));
  },{signal:events.signal}));
  output.addEventListener('change',()=>{
    const enabled=output.checked;output.blur();
    edit((operator,count)=>onOutput(operator,enabled,count));
  },{signal:events.signal});
  return {
    update(state,{operator=0,readOnly=false}={}) {
      if(disposed)return;
      selected=operator;
      count=Number(state.config.mode.slice(2));
      const fm=[2,4,6].includes(count);
      const active=fm&&state.config.fm.algorithm==='custom';
      locked=readOnly||!active;
      $('scspCustomFmControls').hidden=!active;
      $('scspCustomFmOption').disabled=readOnly||!fm;
      $('scspCustomFmInputYLabel').hidden=count===2;
      const unused=operator>=count;
      $('scspCustomFmTarget').textContent=unused?`Custom ${count}OP · choose A–${'ABCDEF'[count-1]}`:`Custom · operator ${'ABCDEF'[operator]}`;
      input.disabled=inputY.disabled=output.disabled=locked||unused;
      if(!active||unused)return;
      const graph=state.config.fm.custom;
      input.value=graph.inputs[operator].length?String(graph.inputs[operator][0]):'';
      inputY.value=graph.inputs[operator].length>1?String(graph.inputs[operator][1]):'';
      inputY.disabled=locked||count===2||input.value===''||input.value===String(operator);
      const selfOperators=graph.inputs.flatMap((sources,index)=>sources.includes(index)?[index]:[]);
      [input,inputY].forEach((control,port)=>{
        const other=port===0?inputY.value:input.value;
        for(const option of control.options){
          option.hidden=option.value!==''&&Number(option.value)>=count;
          const self=option.value===String(operator);
          if(option.value===''){
            if(port===1)option.textContent=input.value===String(operator)?'Past history · Y0':'Same as X';
          }else option.textContent=self&&port===0?`Self · ${'ABCDEF'[operator]} (2 taps)`:'ABCDEF'[Number(option.value)];
          option.disabled=option.hidden||(self&&(port!==0||(count===2&&selfOperators.some(index=>index!==operator))))||(option.value!==''&&option.value===other);
        }
      });
      output.checked=graph.outputs.includes(operator);
      const direct=graph.outputs.length
        ? `Direct output · ${graph.outputs.map(index=>'ABCDEF'[index]).join(' + ')}${inputY.value!==''?' · X/Y are averaged':''}`
        : 'Direct outputs Off · use an Output checkbox or an explicit DSP Send.';
      const names=operators=>operators.map(index=>'ABCDEF'[index]).join(' + ');
      const off=selfOperators.filter(index=>(state.config.fm.depths?.[index]??state.config.fm.depth)===0);
      let selfHint='';
      if(selfOperators.length){
        const history=off.length===selfOperators.length?'Off (Depth 0)':`X32/Y0 · 2 histories${selfOperators.length>1?' each':''}`;
        selfHint=` · Self ${names(selfOperators)} · ${history}`;
        if(off.length&&off.length<selfOperators.length)selfHint+=` · Off (Depth 0): ${names(off)}`;
      }
      $('scspCustomFmHint').textContent=direct+selfHint;
    },
    dispose(){disposed=true;events.abort();},
  };
}
