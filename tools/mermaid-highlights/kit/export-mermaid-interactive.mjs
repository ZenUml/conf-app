#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {exportMermaidInteractive} from '../src/mermaid-interactive-export.mjs';
const args=process.argv.slice(2);
if(args.length!==2){console.log('Usage: node kit/export-mermaid-interactive.mjs input.mmd output.html');process.exit(1)}
try{
  const input=path.resolve(args[0]),outPath=path.resolve(args[1]),actualInput=fs.realpathSync(input),actualOutput=path.join(fs.realpathSync(path.dirname(outPath)),path.basename(outPath));
  if(actualInput===actualOutput||fs.existsSync(outPath)&&fs.realpathSync(outPath)===actualInput)throw Error('OUTPUT_MUST_DIFFER_FROM_INPUT');
  console.log(JSON.stringify(await exportMermaidInteractive(fs.readFileSync(input),{outPath}),null,2));
}catch(error){console.error(`Mermaid interactive export failed: ${error.message}`);process.exitCode=1}
