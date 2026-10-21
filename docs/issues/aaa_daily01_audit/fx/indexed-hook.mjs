import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(process.env.FX_AUDIT_REPO_ROOT??process.cwd());
const original=pathToFileURL(root+'/web/custom_fx.js').href;
const candidate=pathToFileURL(dirname(fileURLToPath(import.meta.url))+'/custom_fx.indexed-candidate.mjs').href;
registerHooks({resolve(specifier,context,nextResolve){const result=nextResolve(specifier,context);return result.url===original?{url:candidate,shortCircuit:true}:result;}});
