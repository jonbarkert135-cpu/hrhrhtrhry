/** Bounded, indexed geometry format: two uint32 counts, interleaved XYZ/normal, uint16 indices. */
export function decodeSculpture(buffer: ArrayBuffer) {
  if (buffer.byteLength < 8 || buffer.byteLength > 512_000) throw new Error('Invalid sculpture');
  const header = new DataView(buffer);
  const vertices = header.getUint32(0, true);
  const count = header.getUint32(4, true);
  if (
    vertices < 3 ||
    vertices > 65_535 ||
    count < 3 ||
    count % 3 !== 0 ||
    buffer.byteLength !== 8 + vertices * 24 + count * 2
  )
    throw new Error('Invalid sculpture geometry');
  const data = new Float32Array(buffer, 8, vertices * 6);
  const indices = new Uint16Array(buffer, 8 + vertices * 24, count);
  if (
    !data.every((value) => Number.isFinite(value) && Math.abs(value) <= 8) ||
    !indices.every((index) => index < vertices)
  )
    throw new Error('Invalid sculpture coordinates');
  return { data, indices, count };
}
