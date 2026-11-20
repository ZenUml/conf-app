import type { GetSourceMap } from '../types';
import { getSourceMap } from './getSourceMap';

// Compile-time check: the implementation satisfies the contract's seam.
// It also takes an optional `{ onReject }` for diagnostics.
const contract: GetSourceMap = getSourceMap;
void contract;

export { getSourceMap };
