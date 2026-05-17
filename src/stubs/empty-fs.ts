// Empty `fs` stub for the asyncapi variant.
//
// @asyncapi/parser/esm/from.js imports { readFile } from 'fs' for its
// `fromURL` / `fromFile` helpers, which we never call (the viewer always
// passes a pre-parsed schema object to @asyncapi/react-component). Vite
// needs the named export to exist so Rollup's strict named-import
// resolution doesn't fail the build — but the function body can throw
// because no runtime code path reaches it.
//
// Previous attempt aliased fs -> memfs, but memfs@4 contains class
// hierarchies (FileHandle / Stats) whose internal `class X extends Y`
// resolves to undefined under the bundler's CJS interop, crashing the
// viewer entry at module evaluation time with "Class extends value
// undefined". A minimal hand-written stub is simpler and avoids pulling
// the memfs runtime into the variant bundle.

function unsupported(name: string): never {
  throw new Error(`fs.${name} is not supported in the browser`)
}

export const readFile = (..._args: unknown[]) => unsupported('readFile')
export const writeFile = (..._args: unknown[]) => unsupported('writeFile')
export const access = (..._args: unknown[]) => unsupported('access')
export const stat = (..._args: unknown[]) => unsupported('stat')
export const readdir = (..._args: unknown[]) => unsupported('readdir')
export const mkdir = (..._args: unknown[]) => unsupported('mkdir')
export const constants = {}

export const promises = {
  readFile: (..._args: unknown[]) => unsupported('promises.readFile'),
  writeFile: (..._args: unknown[]) => unsupported('promises.writeFile'),
  access: (..._args: unknown[]) => unsupported('promises.access'),
  stat: (..._args: unknown[]) => unsupported('promises.stat'),
  readdir: (..._args: unknown[]) => unsupported('promises.readdir'),
  mkdir: (..._args: unknown[]) => unsupported('promises.mkdir'),
}

export default { readFile, writeFile, access, stat, readdir, mkdir, constants, promises }
