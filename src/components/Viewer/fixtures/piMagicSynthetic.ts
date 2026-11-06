import type { MagicArtifact } from '@/model/Diagram/Diagram'
import producedArtifact from './piMagicSynthetic.json'

/** Exact synthetic Mermaid bytes supplied to the local Pi /magic producer. */
export const PI_MAGIC_SYNTHETIC_SOURCE = 'flowchart LR\n A[Start] --> B[Finish]\n'

/** Output of Pi diagram agent 0.84.2; SVG SHA-256 4130f03a0d1bdb0723992a19d15ee188b809a10ee7cb65c2279ce2ed3f6835bb. */
export const PI_MAGIC_SYNTHETIC_ARTIFACT = producedArtifact as MagicArtifact
