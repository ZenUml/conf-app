import { type PrRef, type ReviewGroup, type ReviewGroupItem } from '@zenuml/pr-panel-shared'

export interface BrowserTab { id?: number; url?: string }
export interface ReviewTabApi {
  create(url: string, active: boolean): Promise<BrowserTab>
  get(id: number): Promise<BrowserTab>
  update(id: number, url: string): Promise<void>
  getOwnedId(): Promise<number | null>
  setOwnedId(id: number): Promise<void>
}

export function itemUrl(item: ReviewGroupItem): string {
  const { pr } = item
  return pr.url ?? `https://${pr.host}/${pr.owner}/${pr.repo}/pull/${pr.number}`
}

export function urlMatchesPr(url: string | undefined, pr: PrRef): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    const expected = `/${pr.owner}/${pr.repo}/pull/${pr.number}`.toLowerCase()
    return parsed.hostname.toLowerCase() === pr.host.toLowerCase()
      && (path === expected || path.startsWith(`${expected}/`))
  } catch { return false }
}

/** Only this tab is eligible for agent-driven advance. Its identity survives MV3 restarts. */
export class ReviewTabs {
  constructor(private readonly api: ReviewTabApi) {}

  async openInitial(group: ReviewGroup, active = false): Promise<void> {
    const first = group.items.find((item) => item.outcome === 'pending')
    if (!first) return
    const tab = await this.api.create(itemUrl(first), active)
    if (tab.id !== undefined) await this.api.setOwnedId(tab.id)
  }

  async continue(group: ReviewGroup): Promise<void> {
    const next = group.items.find((item) => item.outcome === 'pending')
    if (!next) return
    const owned = await this.ownedGroupTab(group)
    if (owned?.id !== undefined) await this.api.update(owned.id, itemUrl(next))
    else await this.openInitial(group, true)
  }

  async ownedTabId(): Promise<number | null> { return this.api.getOwnedId() }

  async advanceAfterAi(group: ReviewGroup, completed: PrRef, documentTabId: number | undefined): Promise<boolean> {
    const next = group.items.find((item) => item.outcome === 'pending')
    if (!next || documentTabId === undefined) return false
    const id = await this.api.getOwnedId()
    if (id === null || id !== documentTabId) return false
    try {
      const tab = await this.api.get(id)
      if (!urlMatchesPr(tab.url, completed)) return false
      await this.api.update(id, itemUrl(next))
      return true
    } catch { return false }
  }

  private async ownedGroupTab(group: ReviewGroup): Promise<BrowserTab | null> {
    const id = await this.api.getOwnedId()
    if (id === null) return null
    try {
      const tab = await this.api.get(id)
      return group.items.some((item) => urlMatchesPr(tab.url, item.pr)) ? tab : null
    } catch { return null }
  }
}
