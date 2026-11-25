// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';

const curves=['− Lin','− Exp','+ Exp','+ Lin'];
const groups={
  Oscillator:[
    ['mode','Mode',1,['ratio','fixed']],['coarse','Coarse',31],['fine','Fine',99],
    ['detune','Detune',14],['outputLevel','Output',99],
  ],
  Envelope:['rates','levels'].flatMap(key=>[0,1,2,3].map(i=>[
    'envelope.'+key+'.'+i,(key==='rates'?'R':'L')+(i+1),99,
  ])),
  Scaling:[
    ['keyboardScaling.breakpoint','Breakpoint',99],['keyboardScaling.leftDepth','Left depth',99],
    ['keyboardScaling.leftCurve','Left curve',3,curves],['keyboardScaling.rightDepth','Right depth',99],
    ['keyboardScaling.rightCurve','Right curve',3,curves],['rateScaling','Rate scaling',7],
    ['ampModSensitivity','AM sensitivity',3],['velocitySensitivity','Velocity',7],
  ],
};

function fieldValue(operator,path){
  return path.split('.').reduce((parent,key)=>parent[key],operator);
}

function operatorPatch(operator,path,value){
  const [key,field,index]=path.split('.');
  if(index!==undefined){
    const values=operator[key][field].slice();
    values[index]=value;
    return {[key]:{[field]:values}};
  }
  return field?{[key]:{[field]:value}}:{[key]:value};
}

export function createOperatorEditor({toolbar,host,selectOperator,change}){
  const controls=[],rows=[],pages=[];
  let operators;
  for(const [group,fields] of Object.entries(groups)){
    const button=document.createElement('button');
    button.textContent=group;
    const table=document.createElement('table');
    table.setAttribute('aria-label',group+' operator parameters');
    pages.push({button,table});
    button.onclick=()=>{
      for(const page of pages){
        page.table.hidden=page.table!==table;
        page.button.setAttribute('aria-pressed',String(page.table===table));
      }
      host.scrollLeft=0;
    };
    button.dataset.group=group;
    toolbar.append(button);host.append(table);
    const header=table.createTHead().insertRow();
    for(const label of ['OP',...fields.map(field=>field[1])]){
      const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);
    }
    const body=table.createTBody();
    for(let op=1;op<=6;op++){
      const row=body.insertRow(),heading=document.createElement('th');
      heading.scope='row';row.append(heading);
      const select=document.createElement('button');
      select.textContent='OP'+op;select.onclick=()=>selectOperator(op);
      heading.append(select);rows.push({op,row,select});
      for(const [path,label,max,choices] of fields){
        const name='OP'+op+' '+label;
        const control=createParamControl({label:name,min:0,max,step:1,value:0,showLabel:false,
          formatValue:value=>choices?choices[value]:String(value),
          onChange(value){
            const next=path==='mode'?choices[value]:value;
            if(fieldValue(operators[op],path)!==next)change(op,operatorPatch(operators[op],path,next),path.startsWith('envelope.')?Number(path.split('.')[2]):undefined);
          },
        });
        const [minus,center,plus]=control.element.querySelectorAll('button');
        minus.setAttribute('aria-label','Decrease '+name);plus.setAttribute('aria-label','Increase '+name);
        center.title=name+' · drag left or right'+(path==='detune'?' · neutral 7':'');
        center.onkeydown=event=>{
          if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
          event.preventDefault();event.stopPropagation();
          (event.key==='ArrowLeft'?minus:plus).click();
        };
        const cell=row.insertCell();cell.dataset.label=label;cell.append(control.element);controls.push({op,path,choices,control});
      }
    }
  }
  pages[0].button.click();
  return (next,selected)=>{
    operators=next;
    for(const {op,path,choices,control} of controls){
      const value=fieldValue(next[op],path);
      control.updateVisual(path==='mode'?choices.indexOf(value):value);
    }
    for(const {op,row,select} of rows){
      row.classList.toggle('selected-op',op===selected);
      select.setAttribute('aria-pressed',String(op===selected));
    }
  };
}
