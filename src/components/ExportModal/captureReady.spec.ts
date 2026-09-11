import { describe, expect, it, vi } from 'vitest';
import { waitForCaptureAssets } from './captureReady';

describe('waitForCaptureAssets', () => {
  it('waits for incomplete images before capture', async () => {
    const root = document.createElement('div');
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { value: false, configurable: true });
    root.appendChild(image);

    let settled = false;
    const pending = waitForCaptureAssets(root).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    image.dispatchEvent(new Event('load'));
    await pending;
    expect(settled).toBe(true);
  });

  it('decodes completed images and tolerates decode failures', async () => {
    const root = document.createElement('div');
    const image = document.createElement('img');
    const decode = vi.fn().mockRejectedValue(new Error('decode failed'));
    Object.defineProperty(image, 'complete', { value: true, configurable: true });
    Object.defineProperty(image, 'decode', { value: decode, configurable: true });
    root.appendChild(image);

    await expect(waitForCaptureAssets(root)).resolves.toBeUndefined();
    expect(decode).toHaveBeenCalledOnce();
  });

  it('re-scans when an image is inserted during the first frame', async () => {
    const root = document.createElement('div');
    const pending = waitForCaptureAssets(root);
    await Promise.resolve();
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { value: true, configurable: true });
    root.appendChild(image);
    await expect(pending).resolves.toBeUndefined();
  });

  it('waits for the production Sequence icon placeholder to become inline SVG', async () => {
    const root = document.createElement('div');
    const participant = document.createElement('div');
    participant.className = 'participant';
    const icon = document.createElement('div');
    icon.className = 'h-6 w-6 mr-1 flex-shrink-0';
    participant.appendChild(icon);
    root.appendChild(participant);

    const pending = waitForCaptureAssets(root, { timeoutMs: 200 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(icon.querySelector('svg')).toBeNull();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.appendChild(svg);

    await expect(pending).resolves.toBeUndefined();
  });

  it('fails instead of capturing an unresolved production icon', async () => {
    const root = document.createElement('div');
    const participant = document.createElement('div');
    participant.className = 'participant';
    const icon = document.createElement('div');
    icon.className = 'h-6 w-6 mr-1 flex-shrink-0';
    participant.appendChild(icon);
    root.appendChild(participant);

    await expect(waitForCaptureAssets(root, { timeoutMs: 5 }))
      .rejects.toThrow('capture assets did not become ready');
  });

  it('rejects when an asset never becomes ready', async () => {
    const root = document.createElement('div');
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { value: false, configurable: true });
    root.appendChild(image);
    await expect(waitForCaptureAssets(root, { timeoutMs: 5 }))
      .rejects.toThrow('capture assets did not become ready');
  });
});
