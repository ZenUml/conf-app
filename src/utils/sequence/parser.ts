// The headless, reentrant ZenUML parser entry, shared by every syntax check.
// `new ZenUml(el).parse()` mounts a React root and appends a headlessui portal
// root to document.body on every call, and neither is ever torn down; it also
// lives in the 3.5 MB renderer chunk. `@zenuml/core/parser` is ~280 KB.

export interface ZenumlErrorDetail {
  line: number;
  column: number;
  msg: string;
}

export interface ZenumlParseResult {
  pass: boolean;
  errorDetails?: ZenumlErrorDetail[];
}

export type ZenumlValidate = (code: string) => ZenumlParseResult;

export const loadZenumlParser = (): Promise<{ validate: ZenumlValidate }> =>
  // @ts-expect-error -- root tsconfig `moduleResolution: "node"` cannot see `exports` subpaths
  import('@zenuml/core/parser') as Promise<{ validate: ZenumlValidate }>;
