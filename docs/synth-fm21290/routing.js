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

// A modulator feeding multiple carriers appears in each affected branch.
export function routingExpression({edges,carriers}){
  function sum(terms){
    if(terms.length===1)return terms[0];
    return '('+terms.map(term=>term.includes(' → ')?'('+term+')':term).join(' + ')+')';
  }
  function branch(op){
    const inputs=edges.filter(([,to])=>to===op).map(([from])=>branch(from));
    return (inputs.length?sum(inputs)+' → ':'')+'OP'+op;
  }
  return sum(carriers.map(branch))+' → OUT';
}

export function renderRouting(container,caption,preset,selected,isChip,select){
  const route=routing(preset.algorithm);
  const expression=routingExpression(route);
  container.replaceChildren('ALGO '+(preset.algorithm+1)+'  ');
  for(const token of expression.split(/(OP[1-6])/)){
    if(!token.startsWith('OP')){container.append(token);continue;}
    const op=Number(token.slice(2)),button=document.createElement('button');
    button.type='button';button.textContent=token;button.dataset.op=op;
    button.style.color='var(--op-'+op+')';
    button.setAttribute('aria-pressed',String(op===selected));
    button.onclick=()=>{
      const index=Array.from(container.children).indexOf(button);
      select(op);
      container.children[index].focus({preventScroll:true});
    };
    container.append(button);
  }
  const {returnFrom,returnTo}=route;
  const unavailable=!isChip && returnFrom!==returnTo;
  caption.textContent='Feedback '+preset.feedback+' · OP'+returnFrom+' → OP'+returnTo+
    (unavailable?' (inactive in MSFA)':preset.feedback===0?' (off)':'');
}
