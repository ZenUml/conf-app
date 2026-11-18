import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
export function runtimePaths(){
  const sdk=fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const piPackage=path.resolve(path.dirname(sdk),'../package.json');
  return {piBin:path.join(path.dirname(piPackage),'dist/bundle/cli.js'),sdk,mermaid:require.resolve('mermaid/dist/mermaid.min.js')};
}
export function configureRuntime(env=process.env){
  env.PI_DIAGRAM_MERMAID_BUNDLE??=runtimePaths().mermaid;
  env.PI_DIAGRAM_PLAYWRIGHT_MODULE??=require.resolve('playwright');
  return env;
}
