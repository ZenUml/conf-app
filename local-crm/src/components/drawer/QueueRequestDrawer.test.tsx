import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CopyCommand } from './QueueRequestDrawer'

describe('QueueRequestDrawer command handoff', () => {
  it('renders selectable command text beside an explicit copy button', () => {
    const command = '/extend-space-license --cloud-id cloud-id --space ENGINEERING --days 7'
    const html = renderToStaticMarkup(<CopyCommand command={command} />)

    expect(html).toContain(`<code>${command}</code>`)
    expect(html).toContain('>Copy</button>')
    expect(html).toContain('aria-label="Copy handover command"')
  })

  it('keeps the missing-context explanation without a copy control', () => {
    const html = renderToStaticMarkup(<CopyCommand command={null} />)

    expect(html).toContain('No command is ready')
    expect(html).not.toContain('aria-label="Copy handover command"')
  })
})
