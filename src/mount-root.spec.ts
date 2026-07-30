import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, inject } from 'vue';
import { mountRoot } from '@/mount-root';
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

describe('mountRoot viewer reporter Seam', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('provides the exact lifecycle reporter to the mounted renderer tree', () => {
    const reporter: ViewerRenderReporter = {
      captureRevision: () => 7,
      rendered: () => undefined,
      failed: () => undefined,
    };
    let injected: ViewerRenderReporter | null = null;
    const Probe = defineComponent({
      setup() {
        injected = inject(viewerRenderReporterKey, null);
        return () => null;
      },
    });

    mountRoot(NULL_DIAGRAM, Probe, {}, { viewerRenderReporter: reporter });

    expect(injected).toBe(reporter);
  });
});
