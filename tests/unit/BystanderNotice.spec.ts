import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/utils/notifyAdmin', () => ({ notifyAdmin: vi.fn() }));
vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    BYSTANDER_NOTICE_SHOWN: 'bystander_notice_shown',
    BYSTANDER_ADMIN_NOTIFIED: 'bystander_admin_notified',
    BYSTANDER_OWNER_SELF_IDENTIFY: 'bystander_owner_self_identify',
  },
  Persona: { BYSTANDER: 'bystander' },
}));

import BystanderNotice from '@/components/UpgradePrompt/BystanderNotice.vue';
import { notifyAdmin } from '@/utils/notifyAdmin';
import { trackUpgradeEvent } from '@/utils/upgradeTracking';

const baseProps = { visible: true, spaceKey: 'ENG', requesterDisplayName: 'Alice' };

describe('BystanderNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits BYSTANDER_NOTICE_SHOWN on mount when visible', () => {
    mount(BystanderNotice, { props: baseProps, attachTo: document.body });
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'bystander_notice_shown',
      expect.objectContaining({ persona: 'bystander' })
    );
  });

  it('calls notifyAdmin when "Notify the space admin" is clicked', async () => {
    (notifyAdmin as any).mockResolvedValue({ notified: true, adminCount: 1 });
    mount(BystanderNotice, { props: baseProps, attachTo: document.body });
    const btn = document.querySelector('[data-testid="notify-admin-btn"]') as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(notifyAdmin).toHaveBeenCalledWith({ spaceKey: 'ENG', requesterDisplayName: 'Alice' });
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'bystander_admin_notified',
      expect.objectContaining({ admin_count: 1 })
    );
  });

  it('emits "showHeavyCreator" when "I am the owner" link is clicked', async () => {
    const wrapper = mount(BystanderNotice, { props: baseProps, attachTo: document.body });
    const link = document.querySelector('[data-testid="self-identify-owner"]') as HTMLElement;
    link.click();
    expect(wrapper.emitted('showHeavyCreator')).toBeTruthy();
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'bystander_owner_self_identify',
      expect.any(Object)
    );
  });

  it('emits close when "Got it" is clicked', async () => {
    const wrapper = mount(BystanderNotice, { props: baseProps, attachTo: document.body });
    const btn = document.querySelector('[data-testid="dismiss-btn"]') as HTMLElement;
    btn.click();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
