import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Storybook sidebar is organised by the product interfaces people look for,
 * not by component type (atom/molecule/layout). The primary groups follow the
 * Confluence journey: viewing, editing, fullscreen inspection, export, and the
 * surrounding Confluence surfaces. `Editor` is subdivided because Diagram and
 * Graph have independent shells. `Shared` remains for components whose surface
 * is selected by their caller.
 *
 * Without this guard the tree drifts: before it existed, 23 story files had
 * accreted 15 top-level groups (8 holding a single story) across two competing
 * taxonomies, with `Editor` and `Editors` both present and `Header` living as both
 * a group and a leaf.
 *
 * Adding a genuinely new surface means adding it here in the same commit. That is
 * the point — `Surface` in catalog.ts is itself a closed union.
 */
const ALLOWED_GROUPS = [
  'View',
  'Editor/Diagram',
  'Editor/Graph',
  'Fullscreen',
  'PNG Export',
  'Byline',
  'Page banner',
  'Get Started',
  'Dashboard',
  'Homepage feed',
  // Components whose surface is decided by their caller (UpgradePrompt's comes from
  // surfaceForActionType(): editor | viewer | byline) or that belong to no surface
  // at all (Icons). See CONTEXT.md, "Cross-surface component".
  'Shared',
] as const

const SRC = path.resolve(__dirname, '..')

function findStoryFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findStoryFiles(full)
    return entry.isFile() && entry.name.endsWith('.stories.ts') ? [full] : []
  })
}

/**
 * Reads the `title:` of the default-exported meta. Anchored on `const meta` because
 * story files also contain `title:` inside sample data — GenericViewer.stories.ts
 * has eight of them, all fixture diagram titles, the first appearing 272 lines
 * before the real one.
 */
function readMetaTitle(file: string): string {
  const source = fs.readFileSync(file, 'utf8')
  const metaIndex = source.indexOf('const meta')
  expect(metaIndex, `${path.relative(SRC, file)} has no \`const meta\` declaration`).toBeGreaterThan(-1)

  const match = /title:\s*['"`]([^'"`]+)['"`]/.exec(source.slice(metaIndex))
  expect(match, `${path.relative(SRC, file)} declares no title on its meta`).not.toBeNull()
  return match![1]
}

describe('Storybook story titles', () => {
  const files = findStoryFiles(SRC)

  it('finds every story file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map((f) => [path.relative(SRC, f), f]))('%s', (_relative, file) => {
    const title = readMetaTitle(file)
    const leaf = title.slice(title.lastIndexOf('/') + 1)
    const group = title.slice(0, title.lastIndexOf('/'))
    const expectedLeaf = path.basename(file, '.stories.ts')

    expect(
      ALLOWED_GROUPS,
      `group "${group}" is not a known surface — add it here only if a real new surface exists`,
    ).toContain(group)

    expect(
      leaf,
      `leaf must equal the story filename so the sidebar's search finds it by filename`,
    ).toBe(expectedLeaf)
  })
})
