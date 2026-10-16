import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import * as stories from './ExportModal.stories'

describe('ExportModal fullscreen story frame configuration', () => {
  it.each([
    [stories.FullscreenNarrow, '880px', '720px', 'modal-exportmodal--fullscreen-inner-editing', stories.FullscreenInnerEditing],
    [stories.FullscreenOverflowEditing, '1280px', '420px', 'modal-exportmodal--fullscreen-inner-overflow-editing', stories.FullscreenInnerOverflowEditing],
  ])('mounts a sized iframe pointing to its configured inner story', (story, width, height, innerId, innerStory) => {
    const render = story.render as (args: { visible: boolean }) => object
    const wrapper = mount(render({ visible: true }) as any)
    const frame = wrapper.find('iframe')

    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe(`iframe.html?id=${innerId}&viewMode=story`)
    expect(frame.attributes('title')).toBe(`Fullscreen modal ${parseInt(width)}x${parseInt(height)}`)
    expect(frame.attributes('style')).toContain(`width: ${width}`)
    expect(frame.attributes('style')).toContain(`height: ${height}`)
    expect(innerStory.render).toBeTypeOf('function')
    wrapper.unmount()
  })
})
