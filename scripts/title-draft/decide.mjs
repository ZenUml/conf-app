// Pure decision step of the title-draft batch job: turn the CLI result text into
// a stored outcome. Model output: {"decision":"draft"|"skip","kind":"flowchart|sequence|state|er|none",
// "confidence":0.0-1.0,"reason":"...","mermaid":"..."}.

function stripFences(text) {
  return String(text ?? '').trim().replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

export async function decide(resultText, minConfidence, parseMermaid) {
  let j;
  try { j = JSON.parse(stripFences(resultText)); } catch { return { status: 'no_diagram', reason: 'unparsable_json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { status: 'no_diagram', reason: 'unparsable_json' };
  if (j.decision !== 'draft') return { status: 'no_diagram', reason: 'skip' };
  const confidence = typeof j.confidence === 'number' ? j.confidence : NaN;
  if (!(confidence >= minConfidence)) return { status: 'no_diagram', reason: 'low_confidence' };
  const mermaid = typeof j.mermaid === 'string' ? j.mermaid.trim() : '';
  if (!mermaid) return { status: 'no_diagram', reason: 'empty_mermaid' };
  try { await parseMermaid(mermaid); } catch { return { status: 'no_diagram', reason: 'mermaid_parse_failed' }; }
  return { status: 'ready', mermaid, kind: typeof j.kind === 'string' ? j.kind : 'none', confidence };
}
