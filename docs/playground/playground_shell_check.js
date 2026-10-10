let revision=0;
function message(value){return typeof value==='string'?value:[value.messageText,...(value.next??[]).map(message)].join(' ');}
/** Use the editor's parser without evaluating project JavaScript. */
export function registerShellCheck(shell,{getMonaco=()=>globalThis.monaco}={}){
  shell.register('check',async context=>{
    const json=context.args.includes('--json'),args=context.args.filter(a=>a!=='--json');
    if(args.length>1||args.some(a=>a.startsWith('-')))throw Error('Usage: check [--json] [PATH]');
    const path=context.resolve(args[0]??'.'),stat=context.fs.stat(path);
    const files=stat.type==='file'?[context.fs.get(path)]:context.fs.list().filter(f=>(path==='/'||f.path.startsWith(path+'/'))&&/\.(?:js|mjs|cjs)$/.test(f.path));
    if(files.some(f=>!f||f.type!=='text'))throw Error('check requires text JavaScript files');
    const monaco=getMonaco();if(!monaco?.languages?.typescript?.getJavaScriptWorker)throw Error('JavaScript syntax checker requires the Monaco editor');
    const factory=await monaco.languages.typescript.getJavaScriptWorker();context.assertActive();
    const diagnostics=[];let errors=0,total=0;
    for(const file of files){
      context.assertActive();
      const uri=monaco.Uri.parse(`file:///__tetorica_shell_check__/${++revision}${file.path}`);
      const model=monaco.editor.createModel(file.data,'javascript',uri);
      try{
        const worker=await factory(uri),found=await worker.getSyntacticDiagnostics(uri.toString());context.assertActive();
        for(const d of found){
          total++;if(d.category===1)errors++;
          if(diagnostics.length>=40)continue;
          const prefix=file.data.slice(0,d.start??0).split('\n');
          diagnostics.push({path:file.path,line:prefix.length,column:prefix.at(-1).length+1,code:d.code,severity:d.category===1?'error':'warning',message:message(d.messageText).slice(0,250)});
        }
      }finally{model.dispose();}
    }
    return {code:errors?1:0,stdout:json?JSON.stringify({files:files.length,diagnostics,total,truncated:total>diagnostics.length})+'\n':diagnostics.map(d=>`${d.path}:${d.line}:${d.column}: ${d.message}`).join('\n')+(diagnostics.length?'\n':`Checked ${files.length} file(s): no syntax errors\n`),stderr:!json&&total>diagnostics.length?'Diagnostics truncated; check a narrower path\n':''};
  });
}
