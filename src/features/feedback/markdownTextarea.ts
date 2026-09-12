export function continueMarkdownList(value: string, selectionStart: number, selectionEnd: number): {
  value: string
  cursor: number
} | null {
  if (selectionStart !== selectionEnd) return null
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const line = value.slice(lineStart, selectionStart)
  const match = line.match(/^(\s*)([-*+]|(\d+)\.)\s(.*)$/)
  if (!match) return null

  const [, indent, marker, number, content] = match
  if (!content.trim()) {
    const next = value.slice(0, lineStart) + value.slice(selectionStart)
    return { value: next, cursor: lineStart }
  }

  const nextMarker = number ? `${Number(number) + 1}.` : marker
  const insertion = `\n${indent}${nextMarker} `
  const next = value.slice(0, selectionStart) + insertion + value.slice(selectionStart)
  return { value: next, cursor: selectionStart + insertion.length }
}
