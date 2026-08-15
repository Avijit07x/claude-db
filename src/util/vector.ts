/** Serialize an embedding for BLOB columns / BSON binary. */
export function packVector(values: number[]): Buffer {
  const floats = Float32Array.from(values);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

export function unpackVector(buffer: Buffer): number[] {
  const copy = Buffer.from(buffer);
  return Array.from(
    new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4),
  );
}

/**
 * Assumes both inputs are L2-normalized, which the embedder guarantees.
 *
 * Different widths are different embedding spaces, and a database accumulates
 * both the moment `provider: auto` upgrades from the 256d builtin to 384d
 * MiniLM. Scoring zero drops those below the relevance floor instead of
 * comparing a prefix and returning a meaningless number.
 *
 * ponytail: width stands in for model identity; store an embedder id per row
 * if two same-size models ever coexist.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
