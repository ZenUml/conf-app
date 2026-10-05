import {mount} from '@vue/test-utils'
import {vi,describe,it,expect,beforeEach} from 'vitest'
import Feedback from './MermaidHighlightFeedback.vue'
import {trackAnalyticsEvent} from '@/utils/analytics/trackAnalyticsEvent'
vi.mock('@/utils/analytics/trackAnalyticsEvent',()=>({trackAnalyticsEvent:vi.fn()}))
const clickText = async (wrapper:any,text:string) => {const button=wrapper.findAll('button').find((b:any)=>b.text().includes(text));expect(button).toBeTruthy();await button.trigger('click')}
describe('real Mermaid relationship feedback',()=>{
  beforeEach(()=>vi.clearAllMocks())
  it('requires actual usage and an available highlighter, then records one impression',async()=>{
    const wrapper=mount(Feedback,{props:{used:false,available:true}})
    expect(wrapper.text()).not.toContain('Do you like')
    await wrapper.setProps({used:true,available:false});expect(wrapper.text()).not.toContain('Do you like')
    await wrapper.setProps({available:true});expect(wrapper.text()).toContain('Do you like')
    await wrapper.setProps({available:false});await wrapper.setProps({available:true})
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(c=>c[0]==='mermaid_highlight_feedback_shown')).toHaveLength(1)
  })
  it('records a dislike and a bounded optional reason before thanking the reader',async()=>{
    const wrapper=mount(Feedback,{props:{used:true,available:true}})
    await clickText(wrapper,'Dislike');expect(wrapper.text()).toContain('What could be better')
    await clickText(wrapper,'Unclear highlights');expect(wrapper.text()).toContain('Thanks for your feedback')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_reason_selected',expect.objectContaining({highlight_feedback:'dislike',highlight_feedback_reason:'unclear'}))
  })
  it('dismissal stays closed through toggle cycles and does not invent an answer',async()=>{
    const wrapper=mount(Feedback,{props:{used:true,available:true}})
    await wrapper.get('[aria-label="Close relationship highlight feedback"]').trigger('click')
    await wrapper.setProps({available:false});await wrapper.setProps({available:true})
    expect(wrapper.text()).not.toContain('Do you like')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_dismissed',expect.objectContaining({highlight_dismiss_stage:'question'}))
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(c=>c[0]==='mermaid_highlight_feedback_answered')).toBe(false)
  })
  it('like leads directly to thanks; skipping a reason records only dismissal',async()=>{
    const liked=mount(Feedback,{props:{used:true,available:true}});await clickText(liked,'👍 Like');expect(liked.text()).toContain('Thanks for your feedback');liked.unmount()
    vi.clearAllMocks()
    const disliked=mount(Feedback,{props:{used:true,available:true}});await clickText(disliked,'Dislike');await clickText(disliked,'Skip')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_dismissed',expect.objectContaining({highlight_dismiss_stage:'reason'}))
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(c=>c[0]==='mermaid_highlight_feedback_reason_selected')).toBe(false)
  })
})
