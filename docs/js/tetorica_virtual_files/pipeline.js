/** Tokenize operators separately from quoted or escaped literal text. */
function tokens(source){
  const out=[];let word='',quote='',escaped=false,started=false,literalWord=false;
  const flush=()=>{if(started)out.push({type:'word',value:word});word='';started=false;literalWord=false;};
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(escaped){word+=c;escaped=false;started=true;continue;}
    if(c==='\\'&&quote!=="'"){escaped=true;started=true;literalWord=true;continue;}
    if(quote){if(c===quote)quote='';else word+=c;continue;}
    if(c==='"'||c==="'"){quote=c;started=true;literalWord=true;continue;}
    if(/\s/.test(c)){flush();continue;}
    if(';&'.includes(c))throw Error('Command chaining is not supported');
    if('|<>'.includes(c)){if('<>'.includes(c)&&started&&!literalWord&&/^\d+$/.test(word))throw Error('File-descriptor redirection is not supported');flush();let value=c;if(c==='>'&&source[i+1]==='>'){value='>>';i++;}out.push({type:'operator',value});continue;}
    word+=c;started=true;
  }
  if(quote||escaped)throw Error('Unterminated quote or escape');flush();return out;
}
/** @typedef {{args:string[],input:string|null,output:{path:string,append:boolean}|null}} PipelineStage */
/** Parse a sequential virtual-text pipeline. No expansion or host shell evaluation.
 * @param {string} source @returns {PipelineStage[]} */
export function parsePipeline(source){
  if(typeof source!=='string')throw TypeError('Expected a command string');
  const stages=[],parts=tokens(source);let stage={args:[],input:null,output:null};
  for(let i=0;i<parts.length;i++){
    const token=parts[i];
    if(token.type==='word'){stage.args.push(token.value);continue;}
    if(token.value==='|'){if(!stage.args.length)throw Error('Missing pipeline command');stages.push(stage);stage={args:[],input:null,output:null};continue;}
    const target=parts[++i];if(!target||target.type!=='word'||!target.value)throw Error('Redirection needs a file path');
    if(token.value==='<'){if(stage.input!==null)throw Error('Only one input redirection per stage');stage.input=target.value;}
    else{if(stage.output!==null)throw Error('Only one output redirection per stage');stage.output={path:target.value,append:token.value==='>>'};}
  }
  if(!stage.args.length){if(parts.length)throw Error('Missing pipeline command');return [];}
  stages.push(stage);
  if(stages.length>32)throw Error('At most 32 pipeline stages');
  if(stages.slice(1).some(s=>s.input!==null))throw Error('Input redirection is only supported on the first stage');
  return stages;
}
