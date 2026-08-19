export function packVector(values: number[]): Buffer {
  const floats = Float32Array.from(values);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

export function unpackVector(buffer: Buffer): number[] {
  const copy = Buffer.from(buffer);
  return Array.from(new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4));
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
