import { describe, expect, it } from 'vitest';
import { claimLinkReveal, linkRevealTarget } from './revealFromLink';

const PAGE = 'https://example.atlassian.net/wiki/spaces/SD/pages/123/Order+flow';

describe('linkRevealTarget', () => {
  it('matches only the macro whose localId is in the link', () => {
    const url = `${PAGE}?zenumlDiagram=900&zenumlLocal=abc-2&dv=1&zn=k9`;
    expect(linkRevealTarget(url, 'abc-2')).toEqual({ localId: 'abc-2', key: 'abc-2|k9' });
    expect(linkRevealTarget(url, 'abc-1')).toBeNull();
  });

  it('uses the version when there is no nonce, and tolerates a missing url or localId', () => {
    expect(linkRevealTarget(`${PAGE}?zenumlLocal=a&dv=4`, 'a')).toEqual({ localId: 'a', key: 'a|4' });
    expect(linkRevealTarget(undefined, 'a')).toBeNull();
    expect(linkRevealTarget(`${PAGE}?zenumlLocal=a`, undefined)).toBeNull();
    expect(linkRevealTarget('not a url', 'a')).toBeNull();
  });
});

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('claimLinkReveal', () => {
  const target = { localId: 'abc-2', key: 'abc-2|k9' };

  it('lets one reveal through per tab, then blocks a refresh', () => {
    const s = new MemoryStorage();
    expect(claimLinkReveal(s as unknown as Storage, target)).toBe(true);
    expect(claimLinkReveal(s as unknown as Storage, target)).toBe(false);
  });

  it('keys by localId and nonce, so another comment link to the same diagram reveals again', () => {
    const s = new MemoryStorage();
    expect(claimLinkReveal(s as unknown as Storage, target)).toBe(true);
    expect(claimLinkReveal(s as unknown as Storage, { localId: 'abc-2', key: 'abc-2|zz' })).toBe(true);
    // Macros on one page share the store: a different macro does not clash.
    expect(claimLinkReveal(s as unknown as Storage, { localId: 'abc-3', key: 'abc-3|k9' })).toBe(true);
  });

  it('reveals when storage is unavailable rather than losing the reveal', () => {
    expect(claimLinkReveal(undefined, target)).toBe(true);
    const broken = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(claimLinkReveal(broken, target)).toBe(true);
  });
});
