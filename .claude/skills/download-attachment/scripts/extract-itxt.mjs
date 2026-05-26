#!/usr/bin/env node
/**
 * Extract iTXt / tEXt / zTXt text chunks from a PNG file.
 *
 * Usage:
 *   node extract-itxt.mjs <path-to-png>
 *
 * For the `zenumlDiagram` keyword (written by our png-embedded-source
 * feature), the value is JSON { diagramType, source } — this script
 * pretty-prints it so the embedded diagram source is immediately readable.
 *
 * Other text chunks: keyword and byte-length on stderr, raw text on stdout.
 */

import fs from 'fs';
import zlib from 'zlib';

const [, , filePath] = process.argv;
if (!filePath) {
  console.error('Usage: node extract-itxt.mjs <path-to-png>');
  process.exit(1);
}

const buf = fs.readFileSync(filePath);

// Verify PNG signature
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!buf.slice(0, 8).equals(PNG_SIG)) {
  console.error('Not a PNG file:', filePath);
  process.exit(1);
}

let offset = 8;
let found = 0;

while (offset < buf.length) {
  const length = buf.readUInt32BE(offset);
  const type = buf.slice(offset + 4, offset + 8).toString('ascii');
  const data = buf.slice(offset + 8, offset + 8 + length);
  // skip CRC (4 bytes)
  offset += 12 + length;

  if (type === 'IEND') break;

  if (type === 'tEXt') {
    const nul = data.indexOf(0);
    const keyword = data.slice(0, nul).toString('latin1');
    const text = data.slice(nul + 1).toString('latin1');
    process.stderr.write(`[tEXt] keyword=${keyword} bytes=${text.length}\n`);
    printValue(keyword, text);
    found++;
  } else if (type === 'zTXt') {
    const nul = data.indexOf(0);
    const keyword = data.slice(0, nul).toString('latin1');
    // byte after nul is compression method (always 0)
    const compressed = data.slice(nul + 2);
    const text = zlib.inflateSync(compressed).toString('latin1');
    process.stderr.write(`[zTXt] keyword=${keyword} bytes=${text.length}\n`);
    printValue(keyword, text);
    found++;
  } else if (type === 'iTXt') {
    const nul1 = data.indexOf(0);
    const keyword = data.slice(0, nul1).toString('utf8');
    const compressionFlag = data[nul1 + 1];
    // nul1+2 = compression method, nul1+3 starts language tag
    const rest = data.slice(nul1 + 3);
    const nul2 = rest.indexOf(0); // end of language tag
    const rest2 = rest.slice(nul2 + 1);
    const nul3 = rest2.indexOf(0); // end of translated keyword
    const textBytes = rest2.slice(nul3 + 1);
    let text;
    if (compressionFlag === 1) {
      text = zlib.inflateSync(textBytes).toString('utf8');
    } else {
      text = textBytes.toString('utf8');
    }
    process.stderr.write(`[iTXt] keyword=${keyword} bytes=${text.length}\n`);
    printValue(keyword, text);
    found++;
  }
}

if (found === 0) {
  process.stderr.write('No text chunks found in PNG.\n');
  process.exit(1);
}

function printValue(keyword, text) {
  if (keyword === 'zenumlDiagram') {
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
      return;
    } catch {
      // fall through to raw output
    }
  }
  // mxGraphModel (DrawIO) is XML — print as-is
  console.log(text);
}
