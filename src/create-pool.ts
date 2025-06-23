import {
  TokenSwap, // ← 이걸 가져옵니다
  CurveType,
  TOKEN_SWAP_PROGRAM_ID,
} from "@solana/spl-token-swap";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";

/* ---------- CLI 플래그 ---------- */
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("token-a-pub-key", { type: "string", demandOption: true })
    .option("token-b-pub-key", { type: "string", demandOption: true })
    .option("trade-fee", { type: "number", default: 25 }) // 0.25 %
    .option("payer", { type: "string", demandOption: true })
    .option("keys-path", { type: "string", demandOption: true })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  /* ---------- 기본 설정 ---------- */
  const keysPath = argv["keys-path"];
  const payerKeyPath = argv.payer;
  const tokenAPubKey = new PublicKey(argv["token-a-pub-key"]);
  const tokenBPubKey = new PublicKey(argv["token-b-pub-key"]);

  // check if keys path exists
  if (!fs.existsSync(keysPath)) {
    fs.mkdirSync(keysPath, { recursive: true });
    console.log(`Created keys directory: ${keysPath}`);
  } else if (!fs.statSync(keysPath).isDirectory()) {
    throw new Error(`Keys path is not a directory: ${keysPath}`);
  }

  // check if payer keypair exists
  if (!fs.existsSync(payerKeyPath)) {
    throw new Error(`Payer keypair does not exist: ${payerKeyPath}`);
  }

  const conn = new Connection(argv.url, "confirmed");

  /* ---------- 예시용 어카운트(생성 로직 생략) ---------- */
  function loadKeypairFromFile(filePath: string, strict?: boolean): Keypair {
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
      return newKeypair;
    }
    // load existing keypair from file
    const secretKey = new Uint8Array(
      JSON.parse(fs.readFileSync(filePath, "utf8"))
    );
    return Keypair.fromSecretKey(secretKey);
  }

  const swap = loadKeypairFromFile(`${keysPath}/swap.json`); // Token Swap 어카운트
  const authority = loadKeypairFromFile(`${keysPath}/authority.json`); // Authority 어카운트
  const lpMint = loadKeypairFromFile(`${keysPath}/lp-mint.json`); // LP Mint 어카운트
  const feeVault = loadKeypairFromFile(`${keysPath}/fee-vault.json`); // Fee Vault 어카운트
  const poolVault = loadKeypairFromFile(`${keysPath}/pool-vault.json`); // Pool Vault 어카운트

  const payerVault = loadKeypairFromFile(payerKeyPath, true); // Payer Vault 어카운트

  /* ---------- 풀 초기화 Instruction ---------- */
  const instruction = TokenSwap.createInitSwapInstruction(
    swap, // tokenSwapAccount
    authority.publicKey, // authority
    tokenAPubKey, // tokenAccountA
    tokenBPubKey, // tokenAccountB
    lpMint.publicKey, // tokenPool (LP Mint)
    feeVault.publicKey, // feeAccount
    poolVault.publicKey, // tokenAccountPool (LP 보관용)
    TOKEN_PROGRAM_ID, // SPL Token Program
    TOKEN_SWAP_PROGRAM_ID, // Swap Program
    BigInt(argv["trade-fee"]), // tradeFeeNumerator
    10_000n, // tradeFeeDenominator
    0n,
    0n, // ownerTradeFee
    0n,
    0n, // ownerWithdrawFee
    0n,
    0n, // hostFee
    CurveType.ConstantProduct, // curveType (0)
    undefined // curveParams (없으면 undefined)
  );

  const tx = new Transaction().add(instruction);
  console.log("Transaction created:", tx);
  const sig = await sendAndConfirmTransaction(conn, tx, [payerVault, swap], {
    commitment: "confirmed",
  });
  console.log("signature:", sig);
})();

/**
 * 사용 예시:
 * ts-node create-pool.ts \
  --token-a-mint 7sANd... \
  --token-b-mint WiCH... \
  --trade-fee 25 \
  --payer C:\keys\payer.json \
  --url http://127.0.0.1:8899
 */
