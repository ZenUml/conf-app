import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    PAYWALL_EXTENSION_QUESTION_ANSWERED: 'paywall_extension_question_answered',
    PAYWALL_EXTENSION_GRANTED: 'paywall_extension_granted',
    PAYWALL_EXTENSION_REPEAT_REQUESTED: 'paywall_extension_repeat_requested',
    PAYWALL_ADMIN_CONTACT_ROUTED: 'paywall_admin_contact_routed',
  },
}));

import PaywallExtensionIntake from './PaywallExtensionIntake.vue';
import { trackUpgradeEvent } from '@/utils/upgradeTracking';
import type { SubmitPaywallExtension } from '@/utils/paywall/paywallExtension';

function radio(value: string): HTMLInputElement {
  return document.querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement;
}

function checkboxAt(index: number): HTMLInputElement {
  return document.querySelectorAll('[data-testid="ai-tool-options"] input')[index] as HTMLInputElement;
}

async function choose(wrapper: VueWrapper, value: string) {
  await radio(value).click();
  await wrapper.vm.$nextTick();
}

async function next(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="extension-next"]').trigger('click');
  await wrapper.vm.$nextTick();
}

async function completeFiveQuestions(wrapper: VueWrapper) {
  await choose(wrapper, 'architecture_design');
  await next(wrapper);
  await choose(wrapper, 'architect_tech_lead');
  await next(wrapper);
  await checkboxAt(1).click(); // GitHub Copilot
  await choose(wrapper, 'zenuml');
  await next(wrapper);
  await choose(wrapper, 'required_template');
  await choose(wrapper, 'restricted');
  await next(wrapper);
  await choose(wrapper, 'space');
  await choose(wrapper, 'today');
  await next(wrapper);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
}

describe('PaywallExtensionIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the disclosure and exactly five ordered questions while preserving back-navigation answers', async () => {
    const wrapper = mount(PaywallExtensionIntake, {
      props: { spaceKey: 'ENG', macroCount: 123, submitRequest: vi.fn() },
      attachTo: document.body,
    });
    expect(wrapper.get('[data-testid="extension-disclosure"]').text()).toContain('registered technical or site contact');

    const questionCopies: string[] = [];
    questionCopies.push(wrapper.get('[data-testid="extension-question-1"]').text());
    await choose(wrapper, 'architecture_design');
    await next(wrapper);
    questionCopies.push(wrapper.get('[data-testid="extension-question-2"]').text());
    await wrapper.get('[data-testid="extension-back"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(radio('architecture_design').checked).toBe(true);
    await next(wrapper);
    await choose(wrapper, 'development_team');
    await next(wrapper);
    questionCopies.push(wrapper.get('[data-testid="extension-question-3"]').text());
    await checkboxAt(1).click();
    await choose(wrapper, 'mermaid');
    await next(wrapper);
    questionCopies.push(wrapper.get('[data-testid="extension-question-4"]').text());
    await choose(wrapper, 'not_required');
    await choose(wrapper, 'restricted');
    await next(wrapper);
    questionCopies.push(wrapper.get('[data-testid="extension-question-5"]').text());

    expect(questionCopies).toHaveLength(5);
    expect(questionCopies.join(' | ')).toMatch(/What are you working.*Who is this diagram.*Which AI tools.*workflow constraints.*What needs unblocking/);
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_extension_question_answered',
      expect.objectContaining({ question_id: 'ai_and_diagrams', ai_diagram_usage: 'mermaid' }),
    );
    wrapper.unmount();
  });

  it('submits only coded answers and renders the authoritative expiry before returning to the editor', async () => {
    const submitRequest = vi.fn<SubmitPaywallExtension>().mockResolvedValue({
      status: 'granted',
      requestId: 'request-1',
      isReplay: false,
      grant: {
        grantId: 'grant-1',
        grantedAt: '2026-08-23T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
        extensionDays: 7,
      },
      adminContactRouting: {
        routingOutcome: 'automatic', reasonCodes: ['technical_contact_unique'],
        overrideUsed: false, cacheAgeHours: 1,
      },
    });
    const wrapper = mount(PaywallExtensionIntake, {
      props: { spaceKey: 'ENG', macroCount: 123, submitRequest },
      attachTo: document.body,
    });
    await completeFiveQuestions(wrapper);

    expect(submitRequest).toHaveBeenCalledWith(expect.objectContaining({
      spaceKey: 'ENG',
      macroCount: 123,
      idempotencyKey: expect.any(String),
      answers: {
        currentTask: 'architecture_design',
        diagramAudience: 'architect_tech_lead',
        aiAndDiagrams: { tools: ['github_copilot'], diagramUsage: 'zenuml' },
        workflowConstraints: { processRequirement: 'required_template', cloudAiPolicy: 'restricted' },
        unblockNeed: { scope: 'space', urgency: 'today' },
      },
    }));
    expect(wrapper.get('[data-testid="extension-granted"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="extension-expiry"]').attributes('datetime')).toBe('2026-08-30T00:00:00.000Z');
    await wrapper.get('[data-testid="extension-return-editor"]').trigger('click');
    expect(wrapper.emitted('granted')).toEqual([['2026-08-30T00:00:00.000Z']]);
    expect(trackUpgradeEvent).toHaveBeenCalledWith('paywall_extension_granted', expect.objectContaining({
      extension_days: 7,
      is_replay: false,
    }));
    expect(trackUpgradeEvent).toHaveBeenCalledWith('paywall_admin_contact_routed', {
      routing_outcome: 'automatic',
      reason_codes: 'technical_contact_unique',
      cache_age_hours: 1,
      override_used: false,
    });
    wrapper.unmount();
  });

  it('routes a repeat to manual review without showing an expiry or promising access', async () => {
    const submitRequest = vi.fn<SubmitPaywallExtension>().mockResolvedValue({
      status: 'manual_review',
      requestId: 'request-2',
      isReplay: false,
      priorGrantCount: 1,
      message: 'received',
    });
    const wrapper = mount(PaywallExtensionIntake, {
      props: { spaceKey: 'ENG', macroCount: 123, submitRequest },
      attachTo: document.body,
    });
    await completeFiveQuestions(wrapper);

    expect(wrapper.get('[data-testid="extension-manual-review"]').text()).toContain('no additional access or expiry was promised');
    expect(wrapper.find('[data-testid="extension-expiry"]').exists()).toBe(false);
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_extension_repeat_requested',
      expect.objectContaining({ prior_grant_count: 1, routing_outcome: 'manual_review' }),
    );
    wrapper.unmount();
  });
});
