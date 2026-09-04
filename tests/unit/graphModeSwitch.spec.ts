import { describe, expect, it, vi } from 'vitest'
import {
  findDrawioMenubar,
  hideDrawioFilename,
  injectGraphModeSwitch,
} from '@/components/DrawIoExtension/graphModeSwitch'
import { getNotchGeometry } from '@/components/Notch/notchGeometry'

function menubarFixture(height = 30, width = 1200) {
  const menubar = document.createElement('div')
  menubar.className = 'geMenubarContainer'
  menubar.style.position = 'relative'
  menubar.style.height = `${height}px`
  menubar.style.width = `${width}px`
  Object.defineProperty(menubar, 'getBoundingClientRect', {
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() { return {} },
    }),
  })
  const menus = document.createElement('div')
  menus.className = 'geMenubar'
  menus.textContent = 'File Edit View Arrange Extras Help'
  menubar.appendChild(menus)
  document.body.appendChild(menubar)
  return menubar
}

describe('injectGraphModeSwitch', () => {
  it('injects Diagram/Board controls into the DrawIO menubar, not a page title bar', () => {
    const menubar = menubarFixture()
    const onSelect = vi.fn()
    injectGraphModeSwitch(menubar, { mode: 'diagram', onSelect })

    const root = menubar.querySelector('.graph-mode-switch') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.parentElement).toBe(menubar)
    expect(root.style.left).toBe('50%')
    expect(root.style.top).toBe('0px')
    expect(root.getAttribute('role')).toBe('group')

    const buttons = [...root.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Diagram', 'Board'])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('input')).toBeNull()
  })

  it('matches menubar height, preserves the cubic shoulders, and has no top stroke', () => {
    const menubar = menubarFixture(30)
    injectGraphModeSwitch(menubar, { mode: 'diagram', onSelect: vi.fn() })
    const root = menubar.querySelector('.graph-mode-switch') as HTMLElement
    expect(root.style.height).toBe('30px')
    const fill = root.querySelector('path[fill="white"]') as SVGPathElement
    const stroke = root.querySelector('path[stroke]') as SVGPathElement
    expect(fill).toBeTruthy()
    expect(fill.getAttribute('d')).toBe(getNotchGeometry(0, 30).fillPath)
    expect(stroke.getAttribute('d')?.trim().endsWith('Z')).toBe(false)
    expect(stroke.getAttribute('d')).not.toMatch(/Z\s*$/)
  })

  it('sets Board as the pressed mode when initialized with board', () => {
    const menubar = menubarFixture()
    injectGraphModeSwitch(menubar, { mode: 'board', onSelect: vi.fn() })
    const buttons = [...menubar.querySelectorAll('.graph-mode-switch button')]
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
  })

  it('notifies onSelect when the other mode is activated via click, Enter, or Space', () => {
    const menubar = menubarFixture()
    const onSelect = vi.fn()
    injectGraphModeSwitch(menubar, { mode: 'diagram', onSelect })
    const board = menubar.querySelectorAll('.graph-mode-switch button')[1] as HTMLButtonElement
    board.click()
    expect(onSelect).toHaveBeenCalledWith('board')

    onSelect.mockClear()
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('board')

    onSelect.mockClear()
    board.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('board')
  })

  it('does not notify onSelect when the already-active mode is clicked', () => {
    const menubar = menubarFixture()
    const onSelect = vi.fn()
    injectGraphModeSwitch(menubar, { mode: 'diagram', onSelect })
    const diagram = menubar.querySelectorAll('.graph-mode-switch button')[0] as HTMLButtonElement
    diagram.click()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps buttons tabbable and styles :focus-visible', () => {
    const menubar = menubarFixture()
    injectGraphModeSwitch(menubar, { mode: 'diagram', onSelect: vi.fn() })
    const buttons = [...menubar.querySelectorAll('.graph-mode-switch button')] as HTMLButtonElement[]
    expect(buttons.every((b) => b.tabIndex >= 0)).toBe(true)
    const css = menubar.ownerDocument.getElementById('zenuml-graph-mode-switch-css')?.textContent || ''
    expect(css).toContain(':focus-visible')
  })

  it('uses a fixed top-center notch when the host is not a short menubar', () => {
    const host = document.createElement('div')
    host.className = 'geToolbarContainer'
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({ width: 52, height: 400, top: 40, left: 0, right: 52, bottom: 440, x: 0, y: 40, toJSON() { return {} } }),
    })
    document.body.appendChild(host)
    injectGraphModeSwitch(host, { mode: 'board', onSelect: vi.fn() })
    const root = host.querySelector('.graph-mode-switch') as HTMLElement
    expect(root.style.position).toBe('fixed')
    expect(root.style.height).toBe('31px')
    expect(root.style.left).toBe('50%')
  })

  it('mounts the sketch switch outside the transient toolbar overflow boundary', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const sketchToolbar = doc.createElement('div')
    sketchToolbar.className = 'geToolbarContainer'
    sketchToolbar.style.overflow = 'hidden'
    Object.defineProperty(sketchToolbar, 'getBoundingClientRect', {
      value: () => ({ width: 180, height: 44, top: 10, left: 10, right: 190, bottom: 54, x: 10, y: 10, toJSON() { return {} } }),
    })
    doc.body.appendChild(sketchToolbar)

    const root = injectGraphModeSwitch(sketchToolbar, { mode: 'board', onSelect: vi.fn() })
    sketchToolbar.remove()

    expect(root.parentElement).toBe(doc.body)
    expect(root.style.position).toBe('fixed')
    expect(root.style.height).toBe('30px')
    expect(doc.querySelector('.graph-mode-switch')).toBe(root)
  })

  // A body-mounted switch is position:fixed and centred, so the constraint is
  // the VIEWPORT, not the toolbar it was measured from. The hide guard was
  // gated on the in-toolbar path, so it could never fire in Board mode and the
  // 252px control was drawn over the sketch chrome on a narrow modal.
  it('hides the body-mounted switch when the viewport is too narrow', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const sketchToolbar = doc.createElement('div')
    sketchToolbar.className = 'geToolbarContainer'
    Object.defineProperty(sketchToolbar, 'getBoundingClientRect', {
      value: () => ({ width: 180, height: 44, top: 0, left: 0, right: 180, bottom: 44, x: 0, y: 0, toJSON() { return {} } }),
    })
    doc.body.appendChild(sketchToolbar)
    Object.defineProperty(doc.documentElement, 'clientWidth', { value: 80, configurable: true })

    const root = injectGraphModeSwitch(sketchToolbar, { mode: 'board', onSelect: vi.fn() })

    expect(root.parentElement).toBe(doc.body)
    expect(root.style.display).toBe('none')
  })

  it('keeps the body-mounted switch visible at a normal viewport width', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const sketchToolbar = doc.createElement('div')
    sketchToolbar.className = 'geToolbarContainer'
    Object.defineProperty(sketchToolbar, 'getBoundingClientRect', {
      value: () => ({ width: 180, height: 44, top: 0, left: 0, right: 180, bottom: 44, x: 0, y: 0, toJSON() { return {} } }),
    })
    doc.body.appendChild(sketchToolbar)
    Object.defineProperty(doc.documentElement, 'clientWidth', { value: 1200, configurable: true })

    const root = injectGraphModeSwitch(sketchToolbar, { mode: 'board', onSelect: vi.fn() })

    expect(root.style.display).not.toBe('none')
  })

  // The mount target can be the toolbar OR the document body, and the mount is
  // retried on a timer. querySelector().remove() removed only the first match.
  it('removes every earlier switch before mounting a replacement', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const sketchToolbar = doc.createElement('div')
    sketchToolbar.className = 'geToolbarContainer'
    Object.defineProperty(sketchToolbar, 'getBoundingClientRect', {
      value: () => ({ width: 180, height: 44, top: 0, left: 0, right: 180, bottom: 44, x: 0, y: 0, toJSON() { return {} } }),
    })
    doc.body.appendChild(sketchToolbar)
    const stale = doc.createElement('div')
    stale.className = 'graph-mode-switch'
    sketchToolbar.appendChild(stale)

    const root = injectGraphModeSwitch(sketchToolbar, { mode: 'board', onSelect: vi.fn() })

    expect(doc.querySelectorAll('.graph-mode-switch')).toHaveLength(1)
    expect(doc.querySelector('.graph-mode-switch')).toBe(root)
  })

  it('keeps Board notch dimensions equal to Diagram despite the taller sketch toolbar', () => {
    const diagramMenubar = menubarFixture(30, 1200)
    const diagramRoot = injectGraphModeSwitch(diagramMenubar, { mode: 'diagram', onSelect: vi.fn() })
    const diagramSize = {
      width: diagramRoot.style.width,
      height: diagramRoot.style.height,
    }

    const sketchToolbar = document.createElement('div')
    sketchToolbar.className = 'geToolbarContainer'
    Object.defineProperty(sketchToolbar, 'getBoundingClientRect', {
      value: () => ({ width: 900, height: 44, top: 10, left: 10, right: 910, bottom: 54, x: 10, y: 10, toJSON() { return {} } }),
    })
    document.body.appendChild(sketchToolbar)

    const boardRoot = injectGraphModeSwitch(sketchToolbar, { mode: 'board', onSelect: vi.fn() })
    expect({ width: boardRoot.style.width, height: boardRoot.style.height }).toEqual(diagramSize)
  })

  it('keeps the minimum reference width when reserved title space is narrow', () => {
    const menubar = menubarFixture(30, 700)
    injectGraphModeSwitch(menubar, {
      mode: 'diagram',
      onSelect: vi.fn(),
      reservedLeftPx: 280,
      reservedRightPx: 300,
    })
    const root = menubar.querySelector('.graph-mode-switch') as HTMLElement
    const width = parseFloat(root.style.width)
    expect(width).toBe(getNotchGeometry(120, 30).width)
  })
})

describe('findDrawioMenubar', () => {
  it('prefers the classic File/Edit menubar over a tall sketch picker', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const picker = doc.createElement('div')
    picker.className = 'geToolbarContainer'
    Object.defineProperty(picker, 'getBoundingClientRect', {
      value: () => ({ width: 52, height: 400, top: 40, left: 0, right: 52, bottom: 440, x: 0, y: 40, toJSON() { return {} } }),
    })
    const menubar = doc.createElement('div')
    menubar.className = 'geMenubarContainer'
    const menus = doc.createElement('div')
    menus.className = 'geMenubar'
    menubar.appendChild(menus)
    Object.defineProperty(menubar, 'getBoundingClientRect', {
      value: () => ({ width: 1200, height: 30, top: 0, left: 0, right: 1200, bottom: 30, x: 0, y: 0, toJSON() { return {} } }),
    })
    doc.body.append(picker, menubar)
    expect(findDrawioMenubar(doc)).toBe(menubar)
  })

  it('in sketch chrome picks the top-wide bar rather than the left picker', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const picker = doc.createElement('div')
    picker.className = 'geToolbarContainer'
    Object.defineProperty(picker, 'getBoundingClientRect', {
      value: () => ({ width: 52, height: 400, top: 48, left: 0, right: 52, bottom: 448, x: 0, y: 48, toJSON() { return {} } }),
    })
    const topBar = doc.createElement('div')
    topBar.className = 'geToolbarContainer'
    Object.defineProperty(topBar, 'getBoundingClientRect', {
      value: () => ({ width: 900, height: 44, top: 0, left: 0, right: 900, bottom: 44, x: 0, y: 0, toJSON() { return {} } }),
    })
    doc.body.append(picker, topBar)
    expect(findDrawioMenubar(doc)).toBe(topBar)
  })

  it('ignores a hidden classic menubar with stale CSS dimensions in sketch chrome', () => {
    const doc = document.implementation.createHTMLDocument('drawio')
    const hiddenClassic = doc.createElement('div')
    hiddenClassic.className = 'geMenubarContainer'
    hiddenClassic.style.display = 'none'
    hiddenClassic.style.width = '1200px'
    hiddenClassic.style.height = '44px'
    hiddenClassic.appendChild(doc.createElement('div')).className = 'geMenubar'

    const topBar = doc.createElement('div')
    topBar.className = 'geToolbarContainer'
    Object.defineProperty(topBar, 'getBoundingClientRect', {
      value: () => ({ width: 138, height: 44, top: 10, left: 10, right: 148, bottom: 54, x: 10, y: 10, toJSON() { return {} } }),
    })
    doc.body.append(hiddenClassic, topBar)

    expect(findDrawioMenubar(doc)).toBe(topBar)
  })
})

describe('hideDrawioFilename', () => {
  it('hides DrawIO filename and status chrome so TITLE remains the only naming control', () => {
    const menubar = menubarFixture()
    const fnameWrapper = document.createElement('div')
    fnameWrapper.className = 'geFilename'
    fnameWrapper.textContent = 'Untitled Diagram'
    const embedTitle = document.createElement('div')
    embedTitle.className = 'geStatusDiv'
    embedTitle.textContent = 'Untitled Graph'
    const sketchStatus = document.createElement('a')
    sketchStatus.className = 'geStatus'
    sketchStatus.textContent = 'Saving…'
    menubar.append(fnameWrapper, embedTitle, sketchStatus)

    hideDrawioFilename(document)

    for (const element of [fnameWrapper, embedTitle, sketchStatus]) {
      expect(getComputedStyle(element).display === 'none' || element.style.display === 'none').toBe(true)
    }
  })
})
