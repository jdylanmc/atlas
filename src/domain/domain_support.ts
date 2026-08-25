function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const sha256Initial = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
  0x5be0cd19,
]);

const sha256RoundConstants = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const utf8Encoder = new TextEncoder();

export function sha256Hex(input: string): string {
  const bytes = utf8Encoder.encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  for (let index = 0; index < 8; index += 1) {
    data[paddedLength - 1 - index] = Math.floor(bitLength / 2 ** (8 * index)) & 0xff;
  }

  const hash = [...sha256Initial];
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] =
        (((data[base] as number) << 24) |
          ((data[base + 1] as number) << 16) |
          ((data[base + 2] as number) << 8) |
          (data[base + 3] as number)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const first =
        rightRotate(words[index - 15] as number, 7) ^
        rightRotate(words[index - 15] as number, 18) ^
        ((words[index - 15] as number) >>> 3);
      const second =
        rightRotate(words[index - 2] as number, 17) ^
        rightRotate(words[index - 2] as number, 19) ^
        ((words[index - 2] as number) >>> 10);
      words[index] =
        ((words[index - 16] as number) +
          first +
          (words[index - 7] as number) +
          second) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rightRotate(e as number, 6) ^
        rightRotate(e as number, 11) ^
        rightRotate(e as number, 25);
      const choose = ((e as number) & (f as number)) ^ (~(e as number) & (g as number));
      const t1 =
        ((h as number) +
          sigma1 +
          choose +
          (sha256RoundConstants[index] as number) +
          (words[index] as number)) >>>
        0;
      const sigma0 =
        rightRotate(a as number, 2) ^
        rightRotate(a as number, 13) ^
        rightRotate(a as number, 22);
      const majority =
        ((a as number) & (b as number)) ^
        ((a as number) & (c as number)) ^
        ((b as number) & (c as number));
      const t2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d as number) + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = ((hash[0] as number) + (a as number)) >>> 0;
    hash[1] = ((hash[1] as number) + (b as number)) >>> 0;
    hash[2] = ((hash[2] as number) + (c as number)) >>> 0;
    hash[3] = ((hash[3] as number) + (d as number)) >>> 0;
    hash[4] = ((hash[4] as number) + (e as number)) >>> 0;
    hash[5] = ((hash[5] as number) + (f as number)) >>> 0;
    hash[6] = ((hash[6] as number) + (g as number)) >>> 0;
    hash[7] = ((hash[7] as number) + (h as number)) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index] as string;
    const rightPoint = rightPoints[index] as string;
    if (leftPoint === rightPoint) continue;
    return leftPoint < rightPoint ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}
