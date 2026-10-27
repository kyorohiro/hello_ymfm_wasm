// Validate the package as a standalone HTTP payload. The server cannot fall
// back to web/, docs/ or node_modules; relative Worklet/WASM URLs stay intact.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const workspace=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const packageRoot=path.resolve(args.find(arg=>arg.startsWith('--root='))?.slice(7)??path.join(workspace,'dist/fm2612'));
const expectedVersion=args.find(arg=>arg.startsWith('--version='))?.slice(10)??'0.2.32';
const output=args.find(arg=>arg.startsWith('--out='))?.slice(6)??'/private/tmp/fm2612-cdrom2-package-browser.json';
const names=args.includes('--chromium')?['chromium']:args.includes('--webkit')?['webkit']:['chromium','webkit'];
if(args.some(arg=>!['--chromium','--webkit'].includes(arg)&&!['--root=','--version=','--out='].some(prefix=>arg.startsWith(prefix))))throw Error('Usage: node scripts/check_fm2612_cdrom2_browser.cjs [--root=PACKAGE] [--version=VERSION] [--chromium|--webkit] [--out=REPORT.json]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map();

// Reuse the real endpoint checks, not the Playground fixture. Only the test
// import prefix changes; create*Audio receives no custom URLs or WASM bytes.
async function template(file,functionName){
  const bytes=await fs.readFile(path.join(__dirname,file)),source=bytes.toString();
  const start=source.indexOf(`async function ${functionName}(`),end=source.indexOf('\nasync function playgroundCheck',start);
  assert(start>=0&&end>start,'Endpoint test function must be present: '+file);
  const capture=/const captureSource\s*=\s*`([\s\S]*?)`;/m.exec(source)?.[1];
  assert(capture,'Endpoint capture processor must be present: '+file);
  const code=source.slice(start,end).replaceAll("'/web/","'/package/");
  assert(!code.includes("'/web/"),'All Browser imports use the package root');
  return {file,sha256:sha(bytes),capture,check:vm.runInThisContext('('+code+')',{filename:file+' (isolated package endpoints)'})};
}

(async()=>{
  const packageBytes=await fs.readFile(path.join(packageRoot,'package.json')),manifest=JSON.parse(packageBytes);
  assert.equal(manifest.name,'tetorica-fm2612');assert.equal(manifest.version,expectedVersion);
  const cdda=await template('check_cdda_browser.cjs','browserCheck'),msm=await template('check_pcengine_cd_browser.cjs','endpointCheck');
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<button id="run">Check packaged CD audio</button>');return;}
      if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
      if(pathname==='/__cdda_capture.js'||pathname==='/__pce_capture.js'){
        res.writeHead(200,{'Content-Type':'text/javascript'}).end(pathname==='/__cdda_capture.js'?cdda.capture:msm.capture);return;
      }
      if(!pathname.startsWith('/package/'))throw Error('Only the isolated package is available');
      const file=path.resolve(packageRoot,pathname.slice('/package/'.length));
      if(!file.startsWith(packageRoot+path.sep))throw Error('Invalid package path');
      const bytes=await fs.readFile(file),name=path.relative(packageRoot,file),hash=sha(bytes);
      if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Package changed during Browser checks: '+name);
      served.set(name,{bytes:bytes.length,sha256:hash});
      const type=path.extname(file)==='.wasm'?'application/wasm':path.extname(file)==='.json'?'application/json':'text/javascript';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(bytes);
    }catch(error){res.writeHead(404).end(error.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{
    for(const unavailable of ['/web/msm5205_audio.js','/docs/generated/cdda_wasm.wasm']){
      const response=await fetch(origin+unavailable);assert.equal(response.status,404,'Source-tree fallback is unavailable: '+unavailable);await response.arrayBuffer();
    }
    for(const name of names){
      const browser=await(name==='chromium'?chromium:webkit).launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{
        for(const[kind,test]of [['cdda',cdda],['msm5205',msm]])for(const rate of[44100,48000]){
          const page=await browser.newPage(),errors=[],bad=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(error.message));
          page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
          page.on('console',message=>{if(message.type()==='error')console.error(`${name}/${kind}/${rate}: ${message.text()}`);});
          try{
            await page.goto(origin);const result=await test.check(page,rate);
            assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);results.push({browser:name,version:browser.version(),kind,...result});
            console.log(`PASS ${manifest.name}@${manifest.version} ${name}/${kind}/${rate}: isolated package, default Worklet/WASM URLs, real PCM and lifecycle`);
          }finally{await page.close();}
        }
      }finally{await browser.close();}
    }
    for(const[name,evidence]of served)assert.equal(sha(await fs.readFile(path.join(packageRoot,name))),evidence.sha256,'Packaged asset stayed unchanged: '+name);
    assert.equal(sha(await fs.readFile(path.join(packageRoot,'package.json'))),sha(packageBytes),'Package metadata stayed unchanged during validation');
    for(const name of ['cdda_audio.js','cdda_player.js','cdda_worklet.js','cdda_pcm.js','cdda_source.js','msm5205_audio.js','msm5205_player.js','msm5205_worklet.js','msm5205_pcm.js','msm5205_sample.js','generated/cdda_wasm.wasm','generated/msm5205_wasm.wasm'])assert(served.has(name),'Served from isolated package: '+name);
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,isolatedPackageOnly:true,packageRoot,
      package:{name:manifest.name,version:manifest.version,manifestSha256:sha(packageBytes)},results,
      templates:[cdda,msm].map(({file,sha256})=>({file,sha256})),
      sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    await fs.writeFile(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
