export function shellError(error,{path=null,filename=null,line=null,column=null}={}){
  path=error?.virtualPath??path;
  const raw=typeof error==='string'?error:String(error?.stack??error?.message??error);
  const stack=String(error?.stack??raw).slice(0,8000);
  const source=stack.match(/tetorica-shell:([^\s)]+):(\d+):(\d+)/);
  if(source){try{path=decodeURI(source[1]);}catch{path=source[1];}line=Number(source[2]);column=Number(source[3]);}
  else if(filename?.startsWith('tetorica-shell:')){try{path=decodeURI(filename.slice(15));}catch{path=filename.slice(15);}}
  const first=raw.split('\n')[0],kind=first.match(/^([A-Za-z]+Error):\s*(.*)$/);
  return {name:String(error?.name??kind?.[1]??'Error').slice(0,100),message:String(error?.message??kind?.[2]??first).slice(0,2000),stack,path,line:Number.isSafeInteger(line)&&line>0?line:null,column:Number.isSafeInteger(column)&&column>0?column:null};
}
/** Bound the serialized report, including escaped text and duplicated console output. */
export function boundedShellReport(report){
  report=structuredClone(report);
  let json=JSON.stringify(report);
  while(json.length>32000){
    report.truncated.report=true;
    if(report.console.length)report.console.pop();
    else{
      const candidates=[[report,'stdout'],[report,'stderr'],[report.error??{},'stack'],[report.error??{},'message']];
      candidates.sort((a,b)=>(b[0][b[1]]?.length??0)-(a[0][a[1]]?.length??0));
      const [owner,key]=candidates[0];if(!owner[key])throw Error('Run report metadata exceeds output limit');
      owner[key]=owner[key].slice(0,Math.floor(owner[key].length/2));
    }
    json=JSON.stringify(report);
  }
  return report;
}
