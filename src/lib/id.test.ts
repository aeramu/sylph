import { describe, expect, it } from 'vitest';
import { createId } from './id';

describe('createId', () => {
  it('uses randomUUID when the browser provides it', () => {
    expect(createId({ randomUUID: () => 'secure-id' })).toBe('secure-id');
  });

  it('uses getRandomValues when randomUUID is unavailable on plain HTTP', () => {
    const id = createId({
      getRandomValues: (array) => {
        (array as Uint8Array).fill(0xab);
        return array;
      },
    });

    expect(id).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('falls back without Web Crypto and still returns distinct ids', () => {
    const first = createId(null);
    const second = createId(null);

    expect(first).toMatch(/^local-/);
    expect(second).toMatch(/^local-/);
    expect(second).not.toBe(first);
  });

  it('falls back if an exposed randomUUID method rejects the context', () => {
    expect(createId({ randomUUID: () => { throw new Error('insecure context'); } })).toMatch(/^local-/);
  });
});
