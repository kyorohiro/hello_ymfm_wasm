// SPDX-License-Identifier: BSD-3-Clause
/** Direct raw SPC voice controls: Auto's portable preset is never mutated. */
export function createSnesChannelEditor({root,onEdit,onError=()=>{}}){
 const doc=root.ownerDocument,controls=new Map(),cleanups=[];let state=null,disposed=false,pending=0,bound=null;
 const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 root.className='snes-spc-edit';root.append(make('h3','SPC channel controls'));
 const help=make('p','Edits affect this physical SPC voice immediately, including during playback. The driver may overwrite them. Stop / Seek reload the original song. Copy to Auto to save an authored preset.');root.append(help);
 const fields=make('div');fields.className='snes-spc-edit-fields';root.append(fields);
 const status=make('p');status.id='spcChannelEditStatus';status.setAttribute('role','status');root.append(status);
 function add(key,label,options){
  const row=make('label',label),input=make(options.choices?'select':'input');input.id='spcEdit-'+key;input.dataset.spcEdit=key;
  if(options.choices){for(const [value,label]of options.choices){const option=make('option',label);option.value=value;input.append(option);}}
  else {input.type='number';input.required=true;input.min=String(options.min);input.max=String(options.max);input.step='1';}
  row.append(input);fields.append(row);controls.set(key,input);
  const change=async()=>{if(disposed||!state||state.selected===null)return;const binding=bound,channel=state.selected,value=options.choices?input.value:Number(input.value);input.blur();if(!options.choices&&(!input.checkValidity()||!Number.isInteger(value))){input.reportValidity();update(state);return;}
   pending++;update(state);status.textContent=`Applying CH${channel+1} ${label}…`;status.dataset.error='false';
   try{await onEdit({[key]:value});if(!disposed&&bound===binding)status.textContent=`CH${channel+1} updated · later driver writes take precedence.`;}
   catch(error){if(!disposed&&bound===binding){status.textContent=error.name==='AbortError'?'Edit cancelled after changing channel, source or transport.':`Edit failed: ${error.message}`;status.dataset.error=String(error.name!=='AbortError');if(error.name!=='AbortError')onError(error);}}
   finally{pending--;if(!disposed)update(state);}
  };input.addEventListener('change',change);cleanups.push(()=>input.removeEventListener('change',change));
 }
 add('volumeLeft','Volume left',{min:-128,max:127});add('volumeRight','Volume right',{min:-128,max:127});add('pitch','PITCH',{min:0,max:16383});
 add('envelopeMode','Envelope',{choices:[['adsr','ADSR'],['gain','GAIN']]});add('attack','Attack',{min:0,max:15});add('decay','Decay',{min:0,max:7});add('sustainLevel','Sustain level',{min:0,max:7});add('sustainRate','Sustain rate',{min:0,max:31});
 add('gainMode','GAIN shape',{choices:[['direct','Direct level'],['linear-decrease','Linear decrease'],['exponential-decrease','Exponential decrease'],['linear-increase','Linear increase'],['bent-increase','Bent increase']]});add('gainLevel','Direct GAIN',{min:0,max:127});add('gainRate','GAIN rate',{min:0,max:31});
 function update(next){if(disposed)return;state=next;const key=String(state.sourceId)+':'+state.selected,changed=key!==bound;bound=key;if(changed){status.textContent='';status.dataset.error='false';}root.hidden=state.selected===null;const voice=state.view?.candidate?.voice,busy=state.busy||pending>0;const values=voice?{...voice,gainLevel:voice.gain&127,gainRate:voice.gain&31}:{};
  for(const [key,input]of controls){const mode=voice?.envelopeMode==='gain',direct=voice?.gainMode==='direct';input.disabled=busy||!voice||(['attack','decay','sustainLevel','sustainRate'].includes(key)&&mode)||(['gainMode','gainLevel','gainRate'].includes(key)&&!mode)||(key==='gainLevel'&&!direct)||(key==='gainRate'&&direct);
   if((changed||doc.activeElement!==input)&&values[key]!==undefined)input.value=String(values[key]);
  }
 }
 return{update,dispose(){disposed=true;for(const cleanup of cleanups)cleanup();root.replaceChildren();}};
}
