import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

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

export function loadKeypairFromFile(
  filePath: string,
  strict?: boolean
): Keypair {
  console.log(`Loading keypair from file: ${filePath}...`);
  if (!fs.existsSync(filePath)) {
    if (strict === true) {
      throw new Error(`Keypair file does not exist: ${filePath}`);
    }
    // generate and save a new keypair if file does not exist
    const newKeypair = Keypair.generate();
    fs.writeFileSync(
      filePath,
      JSON.stringify(Array.from(newKeypair.secretKey))
    );
    console.log(
      `✅ Generated new keypair and saved to ${filePath}:`,
      newKeypair.publicKey.toBase58()
    );
    return newKeypair;
  }
  // load existing keypair from file
  const secretKey = new Uint8Array(
    JSON.parse(fs.readFileSync(filePath, "utf8"))
  );
  const keypair = Keypair.fromSecretKey(secretKey);
  console.log(
    `✅ Loaded keypair from ${filePath}:`,
    keypair.publicKey.toBase58()
  );
  return keypair;
}

export function readAddressFromFile(filepath: string): string {
  const fullPath = path.resolve(filepath);
  return fs.readFileSync(fullPath, { encoding: "utf8" }).trim();
}

export function saveFileTo(filePath: string, data: string | Buffer): void {
  fs.writeFileSync(filePath, data);
  console.log(`✅ Saved data to ${filePath}`);
}
