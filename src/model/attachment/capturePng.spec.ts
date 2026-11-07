import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DOM->PNG capture (model/captureBlob), which replaced the direct
// htmlToImage.toBlob() call — see model/captureBlob.ts for why.
vi.mock('@/model/captureBlob', () => ({
  captureBlob: vi.fn(),
  default: vi.fn()
}));

// Mock md5
vi.mock('md5', () => ({
  default: vi.fn((str) => `hash-${str}`)
}));

// Mock window utils
vi.mock('@/utils/window.ts', () => ({
  trackEvent: vi.fn()
}));

import { capturePng } from './capturePng';
import { captureBlob } from '@/model/captureBlob';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Markdown preview capture', () => {
  it('rejects a preview that has not rendered the source being saved', async () => {
    document.body.innerHTML = '<div class="screen-capture-content"><div class="markdown-document" data-markdown-source-hash="hash-old"></div></div>';
    await expect(capturePng('markdown', 'new')).rejects.toThrow('still rendering');
    expect(captureBlob).not.toHaveBeenCalled();
  });

  it('captures the matching document', async () => {
    document.body.innerHTML = '<div class="screen-capture-content"><div class="markdown-document" data-markdown-source-hash="hash-new"></div></div>';
    const png = new Blob(['png'], { type: 'image/png' });
    vi.mocked(captureBlob).mockResolvedValue(png);
    await expect(capturePng('markdown', 'new')).resolves.toBe(png);
  });

  it('rejects a capture when the document changes during conversion', async () => {
    document.body.innerHTML = '<div class="screen-capture-content"><div class="markdown-document" data-markdown-source-hash="hash-new"></div></div>';
    vi.mocked(captureBlob).mockImplementation(async () => {
      document.querySelector('.markdown-document')!.setAttribute('data-markdown-source-hash', '');
      return new Blob(['png'], { type: 'image/png' });
    });
    await expect(capturePng('markdown', 'new')).rejects.toThrow('changed during capture');
  });
});
