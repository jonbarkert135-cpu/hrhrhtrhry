import { describe, expect, it } from 'vitest';
import { decodeSculpture } from './sculptureGeometry';

export function triangle() {
  const buffer = new ArrayBuffer(8 + 3 * 24 + 6);
  new DataView(buffer).setUint32(0, 3, true);
  new DataView(buffer).setUint32(4, 3, true);
  new Float32Array(buffer, 8, 18).set([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
  new Uint16Array(buffer, 80, 3).set([0, 1, 2]);
  return buffer;
}
describe('bounded Raven geometry', () => {
  it('decodes indexed finite geometry without copying its buffers', () => {
    const buffer = triangle();
    const result = decodeSculpture(buffer);
    expect(result.count).toBe(3);
    expect(result.data.buffer).toBe(buffer);
    expect([...result.indices]).toEqual([0, 1, 2]);
  });
  it('rejects truncated, oversized, non-finite and out-of-range assets', () => {
    expect(() => decodeSculpture(new ArrayBuffer(4))).toThrow();
    expect(() => decodeSculpture(new ArrayBuffer(512_001))).toThrow();
    const count = triangle();
    new DataView(count).setUint32(4, 4, true);
    expect(() => decodeSculpture(count)).toThrow();
    const nan = triangle();
    new Float32Array(nan, 8, 18)[0] = NaN;
    expect(() => decodeSculpture(nan)).toThrow();
    const index = triangle();
    new Uint16Array(index, 80)[1] = 3;
    expect(() => decodeSculpture(index)).toThrow();
  });
});
