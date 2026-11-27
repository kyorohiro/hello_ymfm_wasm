// SPDX-License-Identifier: BSD-3-Clause
import {createOperatorEnvelopeView} from '../synth/synth_operator_envelope.js';
import {createParamControl} from '../synth/synth_controls.js';

export function arrangeVoiceSections({body,channelList,selected,common,audition,operatorsCard,lfoCard,noiseCard,details,registers,code,status},keyMask,editOperator) {
  const controls=[];
  for (const input of body.querySelectorAll('.chip-field > input,.chip-field > select')) {
    const isSelect=input.tagName==='SELECT', isToggle=input.type==='checkbox';
    if (!isToggle && !isSelect && (input.type!=='number' || input.step==='any')) continue;
    const field=input.parentElement, label=field.querySelector('.chip-field-label').textContent;
    const read=()=>isToggle?input.checked:Number(input.value);
    const view=createParamControl({label,booleanMode:isToggle,value:read(),step:1,
      min:0,max:isSelect?input.options.length-1:isToggle?1:Number(input.max),
      formatValue:value=>isSelect?input.options[value]?.textContent:String(value),
      onChange:value=>{
        if (isToggle) input.checked=value;else input.value=String(value);
        input.dispatchEvent(new Event('change',{bubbles:true}));
      },
    });
    input.hidden=true;
    field.replaceWith(view.element);
    view.element.append(input);
    controls.push(()=>view.updateVisual(read()));
  }
  // Register 0x08 follows the logical operator row order, including M2 before C1.
  const table=operatorsCard.querySelector('table');
  const heading=document.createElement('th');
  heading.scope='col';
  heading.textContent='Key';
  table.tHead.rows[0].cells[0].after(heading);
  for (const [index,row] of Array.from(table.tBodies[0].rows).entries()) {
    const bit=1<<index;
    const button=document.createElement('button');
    button.type='button';
    button.title='Include '+row.cells[0].textContent+' on the next key-on';
    button.setAttribute('aria-label',button.title);
    const sync=()=>{
      const enabled=Boolean(keyMask.read() & bit);
      button.setAttribute('aria-pressed',String(enabled));
      button.textContent=enabled?'ON':'OFF';
    };
    button.onclick=()=>{keyMask.toggle(bit);sync();};
    row.insertCell(1).append(button);
    controls.push(sync);
  }
  const tabs=document.createElement('div'), pages=document.createElement('div');
  tabs.className='voice-tabs';
  tabs.setAttribute('role','group');
  tabs.setAttribute('aria-label','YM2151 parameters');
  pages.className='voice-pages';
  channelList.after(tabs,pages);

  // Optional tools overlay the current page without shifting the keyboard.
  function tool(parent,label,nodes) {
    const toggle=document.createElement('button'), popup=document.createElement('div');
    popup.popover='auto';popup.className='voice-tool';
    toggle.textContent=label;toggle.popoverTargetElement=popup;
    popup.append(...nodes);parent.append(toggle,popup);
    return popup;
  }
  const tools=document.createElement('div');
  tools.className='voice-tools';selected.append(tools);
  tool(tools,'Pitch / gate',[common]);
  tool(tools,'Audition',[audition,selected.querySelector('.subtext')]);
  const popup=tool(tools,'Envelope',[document.getElementById('envelopeEditor').content.cloneNode(true)]);
  popup.classList.add('opm-envelope-editor');
  operatorsCard.querySelector('canvas').remove();
  for (const guide of operatorsCard.querySelectorAll('p.subtext')) popup.append(guide);
  let operatorStates, envelopeChannel;
  const envelopeView=createOperatorEnvelopeView({
    root:popup,
    isOpen:()=>popup.matches(':popover-open'),
    getSelectionKey:()=>envelopeChannel,
    getOperators:()=>operatorStates,
    paramLabel:key=>key==='sl'?'D1L':key.toUpperCase(),
    onEdit(operator,{sl,...patch}) {
      if (sl!==undefined) patch.d1l=sl;
      editOperator(envelopeChannel,operator-1,patch);
    },
  });
  function updateEnvelope(operators,channel) {
    if (!operators) return;
    envelopeChannel=channel;
    operatorStates=[null,...operators.map(op=>({...op,sl:op.d1l}))];
    envelopeView.setVisible(true);
    envelopeView.invalidate();
  }
  tool(noiseCard,'LFO / noise guide',[lfoCard.querySelector('.subtext'),noiseCard.querySelector('.subtext')]);
  const registerPage=document.createElement('section');
  const range=document.createElement('select');
  range.setAttribute('aria-label','Register range');
  const hex=n=>n.toString(16).toUpperCase().padStart(2,'0');
  for (let i=0;i<256;i+=32) range.add(new Option(hex(i)+'–'+hex(i+31),String(i)));
  registerPage.append(range,registers);
  tool(registerPage,'Voice JavaScript',[code,details.querySelector('button')]);
  details.remove();
  const note=status.nextElementSibling;
  if (note) tool(registerPage,'Register guide',[note]);
  let values=[];
  function updateRegisters(next) {
    for (const sync of controls) sync();
    values=next ?? [];
    const start=Number(range.value), lines=[];
    for (let i=start;i<start+32;i+=8) {
      lines.push(hex(i)+'   '+Array.from(values.slice(i,i+8),hex).join(' '));
    }
    registers.textContent=lines.join('\n');
  }
  range.onchange=()=>updateRegisters(values);

  const groups=[['Voice',selected,operatorsCard],['LFO / Noise',lfoCard,noiseCard],['Registers',registerPage]];
  for (const [index,[label,...sections]] of groups.entries()) {
    const tab=document.createElement('button'), page=document.createElement('div');
    page.className='voice-page';page.id='opm-page-'+index;
    tab.textContent=label;tab.setAttribute('aria-controls',page.id);
    page.append(...sections);pages.append(page);tabs.append(tab);
    tab.onclick=()=>selectPage(index);
  }
  function selectPage(index) {
    Array.from(pages.children).forEach((node,i)=>{
      node.inert=i!==index;
      tabs.children[i].setAttribute('aria-pressed',String(i===index));
    });
  }
  selectPage(0);
  return {updateRegisters,updateEnvelope,dispose:envelopeView.dispose};
}
