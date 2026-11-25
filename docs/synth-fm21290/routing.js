// SPDX-License-Identifier: BSD-3-Clause
import {algorithms} from './algorithms.js';

// Read each bus before replacing or adding its next operator, as in renderInto.
export function routing(algorithm){
  const buses=[[],[],[]], edges=[];
  let returnFrom,returnTo;
  algorithms[algorithm].forEach((flags,slot)=>{
    const op=6-slot, input=(flags>>4)&3, output=flags&3;
    if(input)for(const source of buses[input])edges.push([source,op]);
    if(flags&64)returnTo=op;
    if(flags&128)returnFrom=op;
    if(flags&4)buses[output].push(op);
    else buses[output]=[op];
  });
  return {edges,carriers:buses[0],returnFrom,returnTo};
}

// Lower-numbered destinations are visited first. Carriers share the bottom row.
export function renderRouting(container,caption,preset,selected,isChip,select){
  const {edges,carriers,returnFrom,returnTo}=routing(preset.algorithm);
  const depth=[0];
  for(let op=1;op<=6;op++){
    const destinations=edges.filter(([from])=>from===op);
    depth[op]=Math.max(0,...destinations.map(([,to])=>depth[to]+1));
  }
  const bottom=40+Math.max(...depth)*54, height=bottom+57;
  const x=op=>50+(op-1)*100, y=op=>bottom-depth[op]*54;
  const svgNS='http://www.w3.org/2000/svg';
  function svgElement(tag,attributes){
    const el=document.createElementNS(svgNS,tag);
    for(const [key,value] of Object.entries(attributes))el.setAttribute(key,value);
    return el;
  }
  const svg=svgElement('svg',{viewBox:'0 0 600 '+height,preserveAspectRatio:'none','aria-hidden':'true'});
  function line(d,kind,arrow=false){
    const path=svgElement('path',{d,class:kind});
    if(arrow)path.setAttribute('marker-end','url(#route-'+kind+')');
    svg.append(path);
  }
  const defs=svgElement('defs',{});
  for(const kind of ['signal','return']){
    const marker=svgElement('marker',{id:'route-'+kind,viewBox:'0 0 10 10',refX:9,refY:5,
      markerWidth:7,markerHeight:7,markerUnits:'userSpaceOnUse',orient:'auto'});
    marker.append(svgElement('path',{d:'M0 0 L10 5 L0 10 Z',class:'arrow-'+kind}));
    defs.append(marker);
  }
  svg.append(defs);
  for(const [from,to] of edges)line('M'+x(from)+' '+(y(from)+14)+' L'+x(to)+' '+(y(to)-15),'signal',true);
  const busY=bottom+31;
  for(const carrier of carriers)line('M'+x(carrier)+' '+(bottom+14)+' V'+busY,'signal');
  const outX=(Math.min(...carriers.map(x))+Math.max(...carriers.map(x)))/2;
  line('M'+Math.min(...carriers.map(x))+' '+busY+' H'+Math.max(...carriers.map(x)),'signal');
  const output=document.createElement('span');
  output.className='route-output';output.textContent='OUT';
  output.style.left=(outX/6)+'%';output.style.top=(busY+2)+'px';

  const unavailable=!isChip && returnFrom!==returnTo;
  svg.classList.toggle('fb-off',!preset.feedback||unavailable);
  const lane=x(returnFrom)+45, top=y(returnTo)-27;
  line('M'+(x(returnFrom)+33)+' '+y(returnFrom)+' H'+lane+' V'+top+' H'+x(returnTo)+' V'+(y(returnTo)-15),'return',true);

  container.style.height=height+'px';
  container.replaceChildren(svg,output);
  for(let op=1;op<=6;op++){
    const button=document.createElement('button');
    button.type='button';button.textContent='OP'+op;button.dataset.op=op;
    button.style.left=(x(op)/6)+'%';button.style.top=y(op)+'px';
    const destinations=edges.filter(([from])=>from===op).map(([,to])=>'OP'+to);
    if(carriers.includes(op))destinations.push('OUT');
    button.setAttribute('aria-label','OP'+op+' to '+destinations.join(', '));
    button.setAttribute('aria-pressed',String(op===selected));
    button.onclick=()=>select(op);
    container.append(button);
  }
  caption.textContent='Feedback '+preset.feedback+' · OP'+returnFrom+' → OP'+returnTo+
    (unavailable?' (inactive in MSFA)':preset.feedback===0?' (off)':'');
}
