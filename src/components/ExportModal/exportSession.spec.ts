import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@forge/bridge';
import {
  EXPORT_SESSION_EVENT,
  isExportSessionClosePayload,
  isExportSessionEventPayload,
  isExportSessionSnapshot,
  readExportSession,
  receiveExportSession,
  writeExportSession,
  type ExportSessionSnapshot,
} from './exportSession';

const snapshot: ExportSessionSnapshot = {
  annotations: [{
    id: 'note-1',
    type: 'note',
    position: { x: 0.2, y: 0.3 },
    end: { x: 0.2, y: 0.3 },
    text: 'Review this',
    color: '#374151',
    bgColor: 'none',
    fontSize: 14,
    thickness: 2,
    arrowType: '→',
  }],
  watermark: {
    text: 'Confidential',
    opacity: 20,
    fontSize: 24,
    color: '#9ca3af',
    position: 'diagonal',
  },
  watermarkVisible: true,
  background: 'white',
  customBgColor: '#ffffff',
};

function setModalContext(modal?: Record<string, unknown>) {
  (window as any).forgeGlobal = {
    forgeContext: { extension: modal ? { modal } : {} },
  };
}

async function flushBridge() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  setModalContext();
  vi.mocked(events.emit).mockReset();
});

afterEach(() => {
  setModalContext();
  writeExportSession(null);
  vi.mocked(events.emit).mockReset();
});

describe('export session snapshot', () => {
  it('starts empty and keeps state only in memory', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    expect(readExportSession()).toBeNull();
    writeExportSession(snapshot);
    expect(readExportSession()).toEqual(snapshot);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('defensively clones writes and reads', () => {
    const original = structuredClone(snapshot);
    writeExportSession(original);
    original.annotations[0].position.x = 0.9;
    original.watermark.text = 'Changed';

    const firstRead = readExportSession()!;
    expect(firstRead.annotations[0].position.x).toBe(0.2);
    expect(firstRead.watermark.text).toBe('Confidential');

    firstRead.annotations[0].text = 'Mutated read';
    expect(readExportSession()?.annotations[0].text).toBe('Review this');
  });

  it('hydrates once from fullscreen modal context', () => {
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1', exportSession: snapshot });
    expect(readExportSession()).toEqual(snapshot);

    const changed = { ...snapshot, background: 'warm' };
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1', exportSession: changed });
    expect(readExportSession()?.background).toBe('white');
  });

  it('publishes fullscreen writes with the modal macro identity', async () => {
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1' });
    writeExportSession(snapshot);
    await flushBridge();

    expect(events.emit).toHaveBeenCalledWith(EXPORT_SESSION_EVENT, {
      macro_uuid: 'macro-1',
      snapshot,
    });
  });

  it('serializes rapid writes so the latest snapshot cannot be overtaken', async () => {
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1' });
    const emit = vi.mocked(events.emit);
    const emittedBackgrounds: string[] = [];
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => { releaseFirst = resolve; });
    emit.mockImplementation(async (_event, payload) => {
      emittedBackgrounds.push(payload.snapshot.background);
      if (emittedBackgrounds.length === 1) await firstFinished;
    });

    writeExportSession(snapshot);
    writeExportSession({ ...snapshot, background: 'warm' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emittedBackgrounds).toEqual(['white']);

    releaseFirst();
    await flushBridge();
    expect(emittedBackgrounds).toEqual(['white', 'warm']);
  });

  it('does not publish writes from a non-fullscreen context', async () => {
    setModalContext({ macroMode: 'viewer', macro_uuid: 'macro-1' });
    writeExportSession(snapshot);
    await flushBridge();

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('swallows bridge failures after keeping the local write', async () => {
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1' });
    vi.mocked(events.emit).mockRejectedValueOnce(new Error('bridge unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeExportSession(snapshot);
    await flushBridge();

    expect(readExportSession()).toEqual(snapshot);
    expect(warning).toHaveBeenCalledWith('[exportSession] bridge handoff failed:', expect.any(Error));
    warning.mockRestore();
  });

  it('applies received snapshots without echoing them', async () => {
    setModalContext({ macroMode: 'fullscreen', macro_uuid: 'macro-1' });
    expect(receiveExportSession(snapshot)).toBe(true);
    await flushBridge();

    expect(readExportSession()).toEqual(snapshot);
    expect(events.emit).not.toHaveBeenCalled();
    expect(receiveExportSession({ invalid: true })).toBe(false);
    expect(readExportSession()).toEqual(snapshot);
  });

  it('clears the in-memory snapshot with null', () => {
    writeExportSession(snapshot);
    writeExportSession(null);
    expect(readExportSession()).toBeNull();
  });
});

describe('export session payload validation', () => {
  it('accepts valid snapshots and close/event envelopes only', () => {
    expect(isExportSessionSnapshot(snapshot)).toBe(true);
    expect(isExportSessionEventPayload({ macro_uuid: 'macro-1', snapshot })).toBe(true);
    expect(isExportSessionClosePayload({ exportSession: snapshot })).toBe(true);
    expect(isExportSessionEventPayload({ macro_uuid: '', snapshot })).toBe(false);
    expect(isExportSessionEventPayload({ macro_uuid: 'macro-1', snapshot: { nope: true } })).toBe(false);
    expect(isExportSessionClosePayload({ exportSession: { nope: true } })).toBe(false);
    expect(isExportSessionSnapshot({ ...snapshot, annotations: [{ ...snapshot.annotations[0], type: 'unknown' }] })).toBe(false);
  });

  it('enforces bounded coordinates, sizes, opacity, and hex colors', () => {
    const annotation = snapshot.annotations[0];
    const withAnnotation = (patch: Record<string, unknown>) => ({
      ...snapshot,
      annotations: [{ ...annotation, ...patch }],
    });

    expect(isExportSessionSnapshot(withAnnotation({ position: { x: -0.01, y: 0.5 } }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ end: { x: 0.5, y: 1.01 } }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ fontSize: 7 }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ fontSize: 73 }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ thickness: 0 }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ thickness: 13 }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ color: '#fff' }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ bgColor: '#xyzxyz' }))).toBe(false);
    expect(isExportSessionSnapshot(withAnnotation({ bgColor: 'none' }))).toBe(true);

    expect(isExportSessionSnapshot({
      ...snapshot,
      watermark: { ...snapshot.watermark, opacity: -1 },
    })).toBe(false);
    expect(isExportSessionSnapshot({
      ...snapshot,
      watermark: { ...snapshot.watermark, opacity: 101 },
    })).toBe(false);
    expect(isExportSessionSnapshot({
      ...snapshot,
      watermark: { ...snapshot.watermark, color: 'red' },
    })).toBe(false);
  });

  it('accepts only known backgrounds and a six-digit custom color', () => {
    for (const background of ['transparent', 'white', 'warm', 'cool', 'custom']) {
      expect(isExportSessionSnapshot({ ...snapshot, background })).toBe(true);
    }
    expect(isExportSessionSnapshot({ ...snapshot, background: 'blue' })).toBe(false);
    expect(isExportSessionSnapshot({ ...snapshot, customBgColor: '#fff' })).toBe(false);
    expect(isExportSessionSnapshot({ ...snapshot, customBgColor: 'white' })).toBe(false);
    expect(isExportSessionSnapshot({ ...snapshot, customBgColor: '#12abEF' })).toBe(true);
  });

  it('rejects blank or duplicate annotation IDs', () => {
    const annotation = snapshot.annotations[0];
    expect(isExportSessionSnapshot({
      ...snapshot,
      annotations: [{ ...annotation, id: '' }],
    })).toBe(false);
    expect(isExportSessionSnapshot({
      ...snapshot,
      annotations: [{ ...annotation, id: '   ' }],
    })).toBe(false);
    expect(isExportSessionSnapshot({
      ...snapshot,
      annotations: [annotation, { ...annotation, id: annotation.id }],
    })).toBe(false);
  });
});
