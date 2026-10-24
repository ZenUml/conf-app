import {mount} from '@vue/test-utils'
import {vi,describe,it,expect,beforeEach,afterEach} from 'vitest'
import Feedback from './MermaidHighlightFeedback.vue'
import {trackAnalyticsEvent} from '@/utils/analytics/trackAnalyticsEvent'
vi.mock('@/utils/analytics/trackAnalyticsEvent',()=>({trackAnalyticsEvent:vi.fn()}))
const STORAGE_KEY='zenuml.mermaidHighlightFeedback.v1'
const CLOSE='[aria-label="Dismiss relationship highlight feedback"]'
const clickText = async (wrapper:any,text:string) => {const button=wrapper.findAll('button').find((b:any)=>b.text()===text);expect(button).toBeTruthy();await button.trigger('click')}
const calls = (name:string) => vi.mocked(trackAnalyticsEvent).mock.calls.filter(c=>c[0]===name)
const memory = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
const mountPill = (props:Record<string,unknown>={}) => mount(Feedback,{props:{uses:3,available:true,...props}})
const pill = (wrapper:any) => wrapper.find('.highlight-pill')
describe('Mermaid relationship feedback canvas pill',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();localStorage.clear()})
  afterEach(()=>vi.useRealTimers())
  it('waits for the third use and an available highlighter, then records one impression with the use count',async()=>{
    const wrapper=mountPill({uses:0})
    await wrapper.setProps({uses:2});expect(pill(wrapper).exists()).toBe(false)
    await wrapper.setProps({uses:3,available:false});expect(pill(wrapper).exists()).toBe(false)
    await wrapper.setProps({available:true});expect(wrapper.get('.label').text()).toBe('Highlights helpful?')
    await wrapper.setProps({available:false});await wrapper.setProps({available:true})
    expect(calls('mermaid_highlight_feedback_shown')).toHaveLength(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_shown',expect.objectContaining({highlight_feedback_variant:'canvas_pill',highlight_use_count:3}))
  })
  it('hides while a capture is in progress and keeps its state for afterwards',async()=>{
    const wrapper=mountPill()
    await wrapper.setProps({captureMode:true});expect(pill(wrapper).exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    await wrapper.setProps({captureMode:false});expect(pill(wrapper).exists()).toBe(true)
    expect(calls('mermaid_highlight_feedback_shown')).toHaveLength(1)
    expect(calls('mermaid_highlight_feedback_dismissed')).toHaveLength(0)
  })
  it('auto-dismisses after 10 s unless hovered, recording the timeout as the cause',async()=>{
    const wrapper=mountPill()
    await pill(wrapper).trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(10000);expect(pill(wrapper).exists()).toBe(true)
    await pill(wrapper).trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(9900);expect(pill(wrapper).exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(100);expect(pill(wrapper).exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_dismissed',expect.objectContaining({highlight_dismiss_stage:'question',highlight_dismiss_cause:'timeout'}))
    expect(memory()).toEqual({timeouts:1})
  })
  it('returns at most once more after a timeout, then retires',()=>{
    localStorage.setItem(STORAGE_KEY,JSON.stringify({timeouts:1}))
    expect(pill(mountPill()).exists()).toBe(true)
    localStorage.setItem(STORAGE_KEY,JSON.stringify({timeouts:2}))
    expect(pill(mountPill()).exists()).toBe(false)
    expect(calls('mermaid_highlight_feedback_shown')).toHaveLength(1)
  })
  it('a like thanks the reader briefly, then retires the pill for good',async()=>{
    const wrapper=mountPill()
    await clickText(wrapper,'Yes')
    expect(wrapper.get('.label').text()).toBe('Thanks')
    expect(wrapper.find(CLOSE).exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_answered',expect.objectContaining({highlight_feedback:'like'}))
    await vi.advanceTimersByTimeAsync(2500);expect(pill(wrapper).exists()).toBe(false)
    expect(memory().closed).toBe(true)
    expect(pill(mountPill()).exists()).toBe(false)
  })
  it('a dislike asks for a bounded reason inside the pill, with no countdown',async()=>{
    const wrapper=mountPill()
    await clickText(wrapper,'No');expect(wrapper.text()).toContain('Why?')
    await vi.advanceTimersByTimeAsync(10000);expect(wrapper.text()).toContain('Why?')
    await clickText(wrapper,'Unclear');expect(wrapper.get('.label').text()).toBe('Thanks')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_reason_selected',expect.objectContaining({highlight_feedback:'dislike',highlight_feedback_reason:'unclear'}))
    expect(calls('mermaid_highlight_feedback_dismissed')).toHaveLength(0)
  })
  it('× closes at either stage, records the stage and the cause, and never invents an answer',async()=>{
    const question=mountPill();await question.get(CLOSE).trigger('click')
    expect(pill(question).exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_dismissed',expect.objectContaining({highlight_dismiss_stage:'question',highlight_dismiss_cause:'close'}))
    expect(calls('mermaid_highlight_feedback_answered')).toHaveLength(0)
    expect(memory().closed).toBe(true)
    vi.clearAllMocks();localStorage.clear()
    const reason=mountPill();await clickText(reason,'No');await reason.get(CLOSE).trigger('click')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('mermaid_highlight_feedback_dismissed',expect.objectContaining({highlight_dismiss_stage:'reason',highlight_dismiss_cause:'close'}))
    expect(calls('mermaid_highlight_feedback_reason_selected')).toHaveLength(0)
  })
})
