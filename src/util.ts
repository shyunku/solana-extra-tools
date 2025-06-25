import { PublicKey } from "@solana/web3.js";

export function getSeedBuffer(seed: string): Buffer {
  if (typeof seed !== "string") {
    throw new TypeError("Seed must be a string");
  }
  let seedBuf: Buffer;
  try {
    seedBuf = new PublicKey(seed).toBuffer(); // pubkey 로 해석 시도
  } catch {
    if (/^[0-9a-f]+$/i.test(seed)) {
      seedBuf = Buffer.from(seed, "hex"); // hex 인코딩
    } else {
      seedBuf = Buffer.from(seed); // 평문 ASCII
    }
  }

  return seedBuf;
}
