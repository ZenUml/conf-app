import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Storybook sidebar is organised by SURFACE — where the UI is mounted inside
 * Confluence — not by component type (atom/molecule/layout). Group names are DERIVED
 * from the UI-bearing values of the `Surface` union in `src/utils/analytics/catalog.ts`
 * so one word names the same thing in Mixpanel, in CONTEXT.md, and in this tree. Three
 * are union values as-is (`Viewer`, `Modal`, `Page banner`); `Editor` is subdivided
 * because the union's single `editor` value covers two independent shells (Workspace.vue
 * and DrawIoExtension.vue, each with its own header); `Get started` and `Homepage feed`
 * are the two real pages behind the union's `route` catch-all; `Shared` is not a surface
 * at all — see below.
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
  'Viewer',
  'Editor/Diagram',
  'Editor/Graph',
  'Page banner',
  'Modal',
  'Get started',
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
