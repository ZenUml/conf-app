#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {exportInteractiveSvg} from '../src/interactive-export.mjs';

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args[0] === '--help') {
  console.log('Usage: node kit/export-interactive.mjs input.svg [output.html]');
  process.exit(args[0] === '--help' ? 0 : 1);
}
try {
  const input = path.resolve(args[0]);
  const outPath = args[1] ? path.resolve(args[1]) : `${input.replace(/\.svg$/i, '')}.interactive.html`;
  const actualInput=fs.realpathSync(input);
  const actualOutput=path.join(fs.realpathSync(path.dirname(outPath)),path.basename(outPath));
  if (actualInput === actualOutput || fs.existsSync(outPath) && fs.realpathSync(outPath) === actualInput) throw Error('OUTPUT_MUST_DIFFER_FROM_INPUT');
  console.log(JSON.stringify(await exportInteractiveSvg(fs.readFileSync(input), {outPath}), null, 2));
} catch (error) {
  console.error(`Interactive export failed: ${error.message}`);
  process.exitCode = 1;
}
