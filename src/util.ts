import {
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import axios from "axios";

export async function sendTransactionViaRelayer(
  transaction: Transaction,
  relayerUrl: string
): Promise<string> {
  // 트랜잭션을 직렬화합니다.
  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false,
  });

  // 릴레이어에 트랜잭션을 보냅니다.
  try {
    const response = await axios.post(relayerUrl, {
      transaction: serializedTransaction.toString("base64"),
    });
    return response.data.signature;
  } catch (error) {
    console.error("Error sending transaction to relayer:", error);
    throw error;
  }
}

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

/**
 * 데이터를 지정된 파일에 저장합니다.
 * @param filepath - 저장할 파일의 전체 경로 (확장자 제외)
 * @param data - 저장할 데이터
 */
export function saveAddressToFile(filepath: string, data: string): void {
  const fullPath = path.resolve(filepath + ".txt");
  fs.writeFileSync(fullPath, data);
  console.log(`💾 Address saved to ${fullPath}`);
}

export async function ensureAta(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  return getOrCreateAssociatedTokenAccount(conn, payer, mint, owner);
}

export function logarithmRandom<T extends number | bigint>(min: T, max: T): T {
  const logMin = Math.log(Number(min));
  const logMax = Math.log(Number(max));
  const logPicked = logMin + Math.random() * (logMax - logMin);
  const result = Math.exp(logPicked);

  if (typeof min === "bigint" && typeof max === "bigint") {
    return BigInt(Math.floor(result)) as T; // 소수점 제거 필요
  } else {
    return result as T;
  }
}
