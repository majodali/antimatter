import { describe, it, expect } from 'vitest';
import { hashContent } from '../hashing.js';

describe('hashContent', () => {
  it('returns a hex string', () => {
    const hash = hashContent('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns consistent hashes for the same string', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
  });

  it('returns different hashes for different strings', () => {
    expect(hashContent('hello')).not.toBe(hashContent('world'));
  });

  it('hashes Uint8Array content', () => {
    const bytes = new TextEncoder().encode('hello');
    const hash = hashContent(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for string and equivalent Uint8Array', () => {
    const text = 'hello world';
    const bytes = new TextEncoder().encode(text);
    expect(hashContent(text)).toBe(hashContent(bytes));
  });

  it('handles empty content', () => {
    const hash = hashContent('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent(new Uint8Array(0))).toBe(hash);
  });
});
