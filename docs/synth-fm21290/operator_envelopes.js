// SPDX-License-Identifier: BSD-3-Clause
const svgNS='http://www.w3.org/2000/svg';
const limit=value=>Math.max(0,Math.min(99,Math.round(value)));
const stageLeft=index=>27+index*74;
const rateWidth=49;
const levelHeight=77;
const yFor=level=>86-levelHeight*level/99;

function svgNode(name,attributes={}){
  const node=document.createElementNS(svgNS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}

export function createOperatorEnvelopes(root,selectOperator,change){
  const colors=['#52dbbf','#ffb45f','#85b9ff','#ff88af','#cfabff','#e4db68'];
  const legend=document.createElement('div'),readout=document.createElement('output');
  legend.className='envelope-legend';
  legend.setAttribute('role','group');legend.setAttribute('aria-label','Edit operator envelope');
  const svg=svgNode('svg',{viewBox:'0 0 314 110',role:'group','aria-label':'Operator envelopes'});
  const traces=svgNode('g');
  svg.append(traces);root.append(legend,readout,svg);
  const lines=[],buttons=[],handles=[];
  let selected=1,envelope,activeStage=0;
  for(let op=1;op<=6;op++){
    const button=document.createElement('button');
    button.textContent='OP'+op;
    button.setAttribute('aria-label','Select OP'+op+' envelope');
    button.style.setProperty('--op-color',colors[op-1]);
    button.onclick=()=>selectOperator(op);
    legend.append(button);buttons.push(button);
    const line=svgNode('polyline',{stroke:colors[op-1]});
    line.onclick=()=>selectOperator(op);
    traces.append(line);lines.push(line);
  }
  function displayValues(){
    readout.textContent='OP'+selected+' · R'+(activeStage+1)+' '+envelope.rates[activeStage]+' · L'+(activeStage+1)+' '+envelope.levels[activeStage];
  }
  for(let i=0;i<4;i++){
    const stage=i+1;
    const label=svgNode('text',{x:stageLeft(i)+rateWidth/2,y:105});
    label.textContent=String(stage);
    const handle=svgNode('g',{tabindex:0,role:'button'});
    handle.append(svgNode('circle',{r:12,class:'hit'}),svgNode('circle',{r:4,class:'dot'}));
    svg.append(label,handle);
    handle.onfocus=handle.onpointerenter=()=>{activeStage=i;displayValues();};
    let drag=null;
    function point(event){
      return new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    }
    function set(rate,level){
      rate=limit(rate);level=limit(level);
      if(rate===envelope.rates[i] && level===envelope.levels[i])return;
      const rates=envelope.rates.slice(),levels=envelope.levels.slice();
      rates[i]=rate;levels[i]=level;
      change(selected,{envelope:{rates,levels}},i);
    }
    handle.onpointerdown=event=>{
      if(event.button!==0 || drag)return;
      event.preventDefault();
      selectOperator(selected);
      handle.focus({preventScroll:true});
      drag={op:selected,id:event.pointerId,start:point(event),rate:envelope.rates[i],level:envelope.levels[i]};
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove=event=>{
      if(drag?.id!==event.pointerId || drag.op!==selected)return;
      const current=point(event);
      set(drag.rate-(current.x-drag.start.x)*99/rateWidth,drag.level-(current.y-drag.start.y)*99/levelHeight);
    };
    handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=event=>{
      if(drag?.id===event.pointerId)drag=null;
    };
    handle.onkeydown=event=>{
      const delta={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
      if(!delta && event.key!=='Enter' && event.key!==' ')return;
      event.preventDefault();event.stopPropagation();
      selectOperator(selected);
      if(delta)set(envelope.rates[i]+delta[0],envelope.levels[i]+delta[1]);
    };
    handles.push(handle);
  }
  return (operators,op,stage)=>{
    if(stage!==undefined)activeStage=stage;
    selected=op;envelope=operators[op].envelope;
    displayValues();
    svg.style.setProperty('--op-color',colors[op-1]);
    lines.forEach((line,index)=>{
      const active=op===index+1;
      buttons[index].setAttribute('aria-pressed',String(active));
      line.classList.toggle('selected',active);
      const {levels,rates}=operators[index+1].envelope;
      const points=['8,'+yFor(levels[3])];
      for(let i=0;i<4;i++){
        const x=stageLeft(i)+(99-rates[i])*rateWidth/99,y=yFor(levels[i]);
        points.push(x+','+y);
        if(active){
          handles[i].setAttribute('transform','translate('+x+' '+y+')');
          handles[i].setAttribute('aria-label','OP'+op+' stage '+(i+1)+', rate '+rates[i]+', level '+levels[i]);
        }
      }
      line.setAttribute('points',points.join(' '));
    });
    if(traces.lastChild!==lines[op-1])traces.append(lines[op-1]);
  };
}
