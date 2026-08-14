import { describe, expect, it } from 'vitest';
import {
  classifyViewerRelation,
  utcDayStart,
} from './domain';

describe('diagram impact domain', () => {
  it('classifies the current creator before every other contributor relationship', () => {
    expect(classifyViewerRelation({
      accountId: 'person-1',
      createdByAccountId: 'person-1',
      updatedByAccountId: 'person-1',
      isHistoricalContributor: true,
    })).toBe('creator');
  });

  it('classifies the current updater before historical contributor membership', () => {
    expect(classifyViewerRelation({
      accountId: 'person-2',
      createdByAccountId: 'person-1',
      updatedByAccountId: 'person-2',
      isHistoricalContributor: true,
    })).toBe('updater');
  });

  it('classifies a version-history author as a contributor', () => {
    expect(classifyViewerRelation({
      accountId: 'person-3',
      createdByAccountId: 'person-1',
      updatedByAccountId: 'person-2',
      isHistoricalContributor: true,
    })).toBe('contributor');
  });

  it('classifies everybody else as a viewer', () => {
    expect(classifyViewerRelation({
      accountId: 'person-4',
      createdByAccountId: 'person-1',
      updatedByAccountId: 'person-2',
      isHistoricalContributor: false,
    })).toBe('viewer');
  });

  it('normalizes times to their UTC day start', () => {
    expect(utcDayStart(new Date('2026-08-12T23:59:59.999Z'))).toBe('2026-08-12T00:00:00.000Z');
    expect(utcDayStart(new Date('2026-08-13T00:00:00.000Z'))).toBe('2026-08-13T00:00:00.000Z');
  });
});
