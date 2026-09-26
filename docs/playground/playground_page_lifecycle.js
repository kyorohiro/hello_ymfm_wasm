/** Browser lifecycle: bfcache restores editors, never an active audio session. */
export function installPlaygroundPageLifecycle({target, getRuntime, onRestored, onError}) {
 let closing=Promise.resolve();
 target.addEventListener('pagehide',()=>{
  const runtime=getRuntime();
  // Do not wait for a Worker acknowledgement or a timer while the page freezes.
  runtime.megaDrive?.audio?.masterOutputNode?.disconnect();
  const context=runtime.megaDrive?.audioContext;
  if(context?.state==='running')void context.suspend().catch(onError);
  try {
   const result=runtime.finalize();
   closing=Promise.resolve(result);
  }catch(error){closing=Promise.reject(error);}
  // Observe the error now, while keeping the barrier rejected for the next Run.
  void closing.catch(onError);
 });
 target.addEventListener('pageshow',event=>{
  if(event.persisted)void closing.then(onRestored,onError);
 });
 return {beforeRun:()=>closing};
}
