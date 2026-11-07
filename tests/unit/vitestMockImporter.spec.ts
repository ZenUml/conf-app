import { expect, it, vi } from 'vitest';
import { readValue } from '../fixtures/vitest-mock-dependency';

vi.mock('../fixtures/vitest-mock-dependency', () => ({ readValue: vi.fn() }));

it('resolves a relative module mock from the nested test file', async () => {
  vi.mocked(readValue).mockResolvedValue('mocked');
  expect(await readValue()).toBe('mocked');
});
