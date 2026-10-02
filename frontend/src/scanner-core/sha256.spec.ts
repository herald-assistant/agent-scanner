import {describe, expect, it} from 'vitest';
import {encodeUtf8, sha256} from './sha256';

describe('portable evidence digest', () => {
  it('matches standard empty, abc and multi-block SHA-256 vectors', () => {
    expect(sha256(encodeUtf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256(encodeUtf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(encodeUtf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('preserves UTF-8 byte identity, including surrogate replacement', async () => {
    for (const text of ['zażółć', '🙂', '\ud800', 'x'.repeat(130)]) {
      expect([...encodeUtf8(text)]).toEqual([...new TextEncoder().encode(text)]);
      const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      expect(sha256(encodeUtf8(text))).toBe(Array.from(new Uint8Array(expected), byte => byte.toString(16).padStart(2,'0')).join(''));
    }
  });
});
