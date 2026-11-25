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
  const graphs=[];
  for(let op=1;op<=6;op++){
    const card=document.createElement('div');
    card.className='envelope-card';
    const heading=document.createElement('button');
    heading.textContent='OP'+op;
    heading.setAttribute('aria-label','Select OP'+op+' envelope');
    heading.onclick=()=>selectOperator(op);
    const svg=svgNode('svg',{viewBox:'0 0 314 110',role:'group','aria-label':'OP'+op+' envelope'});
    const line=svgNode('polyline');
    svg.append(line);
    const readout=document.createElement('span');
    card.append(heading,readout,svg);root.append(card);
    let activeStage=0;
    function displayValues(){
      readout.textContent='R'+(activeStage+1)+' '+envelope.rates[activeStage]+' · L'+(activeStage+1)+' '+envelope.levels[activeStage];
    }
    let envelope;
    const handles=[];
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
        change(op,{envelope:{rates,levels}});
      }
      handle.onpointerdown=event=>{
        if(event.button!==0 || drag)return;
        event.preventDefault();
        selectOperator(op);
        handle.focus({preventScroll:true});
        drag={id:event.pointerId,start:point(event),rate:envelope.rates[i],level:envelope.levels[i]};
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointermove=event=>{
        if(drag?.id!==event.pointerId)return;
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
        selectOperator(op);
        if(delta)set(envelope.rates[i]+delta[0],envelope.levels[i]+delta[1]);
      };
      handles.push(handle);
    }
    graphs.push((operators,selected)=>{
      envelope=operators[op].envelope;
      displayValues();
      heading.setAttribute('aria-pressed',String(selected===op));
      card.classList.toggle('selected',selected===op);
      const points=['8,'+yFor(envelope.levels[3])];
      handles.forEach((handle,i)=>{
        const rate=envelope.rates[i],level=envelope.levels[i];
        const x=stageLeft(i)+(99-rate)*rateWidth/99,y=yFor(level);
        points.push(x+','+y);
        handle.setAttribute('transform','translate('+x+' '+y+')');
        handle.setAttribute('aria-label','OP'+op+' stage '+(i+1)+', rate '+rate+', level '+level);
      });
      line.setAttribute('points',points.join(' '));
    });
  }
  return (operators,selected)=>graphs.forEach(update=>update(operators,selected));
}
