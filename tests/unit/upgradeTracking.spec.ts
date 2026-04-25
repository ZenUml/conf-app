import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }));

import { trackUpgradeEvent, UpgradeEventName, Persona } from '@/utils/upgradeTracking';
import { trackEvent } from '@/utils/window';

describe('trackUpgradeEvent — new persona events', () => {
  it('maps BYSTANDER_NOTICE_SHOWN to action=impression', () => {
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_NOTICE_SHOWN, { persona: Persona.BYSTANDER });
    expect(trackEvent).toHaveBeenCalledWith(
      'bystander_notice_shown',
      'impression',
      'conversion',
      expect.objectContaining({ persona: 'bystander' })
    );
  });

  it('maps BYSTANDER_ADMIN_NOTIFIED to action=click', () => {
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_ADMIN_NOTIFIED, { persona: Persona.BYSTANDER });
    expect(trackEvent).toHaveBeenCalledWith(
      'bystander_admin_notified',
      'click',
      'conversion',
      expect.objectContaining({ persona: 'bystander' })
    );
  });

  it('maps COMPARISON_VIEW_SHOWN to action=impression', () => {
    trackUpgradeEvent(UpgradeEventName.COMPARISON_VIEW_SHOWN, { tenant_size_estimate: 'unknown' });
    expect(trackEvent).toHaveBeenCalledWith(
      'persona_comparison_view_shown',
      'impression',
      'conversion',
      expect.objectContaining({ tenant_size_estimate: 'unknown' })
    );
  });
});
