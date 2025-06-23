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
  SystemProgram,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createTransferInstruction,
  getMint,
  getOrCreateAssociatedTokenAccount,
  MINT_SIZE,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";

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

/* ---------- CLI 플래그 ---------- */
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("token-a-pub-key", { type: "string", demandOption: true })
    .option("token-b-pub-key", { type: "string", demandOption: true })
    .option("trade-fee", { type: "number", default: 25 }) // 0.25 %
    .option("payer", { type: "string", demandOption: true })
    .option("swap-key-dir", { type: "string", demandOption: true })
    .option("victim-key-dir", { type: "string" })
    .option("victims", { type: "number", default: 5 })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  /* ---------- 기본 설정 ---------- */
  const keysPath = argv["swap-key-dir"];
  const victimKeysPath = argv["victim-key-dir"];
  const payerKeyPath = argv.payer;
  const tokenAPubKey = new PublicKey(argv["token-a-pub-key"]);
  const tokenBPubKey = new PublicKey(argv["token-b-pub-key"]);
  const victimCount = argv.victims; // 피해자 수
  if (victimCount < 1 || victimCount > 100) {
    throw new Error("Victim count must be between 1 and 100.");
  }
  const tradeFee = BigInt(argv["trade-fee"]); // 0.25% = 25

  // check if keys path exists
  if (!fs.existsSync(keysPath)) {
    fs.mkdirSync(keysPath, { recursive: true });
    console.log(`Created keys directory: ${keysPath}`);
  } else if (!fs.statSync(keysPath).isDirectory()) {
    throw new Error(`Keys path is not a directory: ${keysPath}`);
  }

  // check if victim keys path exists
  if (victimKeysPath && !fs.existsSync(victimKeysPath)) {
    fs.mkdirSync(victimKeysPath, { recursive: true });
    console.log(`Created victim keys directory: ${victimKeysPath}`);
  } else if (victimKeysPath && !fs.statSync(victimKeysPath).isDirectory()) {
    throw new Error(`Victim keys path is not a directory: ${victimKeysPath}`);
  }

  // check if payer keypair exists
  if (!fs.existsSync(payerKeyPath)) {
    throw new Error(`Payer keypair does not exist: ${payerKeyPath}`);
  }

  const conn = new Connection(argv.url, "confirmed");
  const victims = Array(victimCount)
    .fill(null)
    .map((_, i) => {
      const victimKeyPath = `${victimKeysPath}/victim-${i + 1}.json`;
      return loadKeypairFromFile(victimKeyPath, false);
    });

  const swap = loadKeypairFromFile(`${keysPath}/swap.json`); // Token Swap 어카운트
  const lpMint = loadKeypairFromFile(`${keysPath}/lp-mint.json`); // LP Mint 어카운트

  const payer = loadKeypairFromFile(payerKeyPath, true); // Payer Vault 어카운트
  const [authority, bump] = PublicKey.findProgramAddressSync(
    [swap.publicKey.toBuffer()],
    TOKEN_SWAP_PROGRAM_ID
  );

  const initA = 1_000_000n;
  const initB = 1_000_000n;

  const payerAtaA = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    tokenAPubKey,
    payer.publicKey // 자기 지갑
  );
  const payerAtaB = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    tokenBPubKey,
    payer.publicKey
  );

  await mintToChecked(
    conn,
    payer, // 민트 authority 키 (TOKEN_A/B를 만들 때 authority = payer 라고 가정)
    tokenAPubKey,
    payerAtaA.address,
    payer,
    1_000_000_000n,
    0 // decimals
  );
  await mintToChecked(
    conn,
    payer,
    tokenBPubKey,
    payerAtaB.address,
    payer,
    1_000_000_000n,
    0
  );

  const tokenAccountA = await getOrCreateAssociatedTokenAccount(
    conn,
    payer, // 수수료 지불 + 초기 토큰 제공
    tokenAPubKey, // A 토큰 Mint
    authority // owner
  );
  const tokenAccountB = await getOrCreateAssociatedTokenAccount(
    conn,
    payer, // 수수료 지불 + 초기 토큰 제공
    tokenBPubKey, // B 토큰 Mint
    authority // owner
  );

  // 초기 유동성 전송 (지갑 → 볼트)
  const transferA = createTransferInstruction(
    payerAtaA.address,
    tokenAccountA.address,
    payer.publicKey,
    initA
  );
  const transferB = createTransferInstruction(
    payerAtaB.address,
    tokenAccountB.address,
    payer.publicKey,
    initB
  );

  const lamportsForMint = await conn.getMinimumBalanceForRentExemption(
    MINT_SIZE
  );
  const createLpMintIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: lpMint.publicKey,
    lamports: lamportsForMint,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });
  const initLpMintIx = createInitializeMintInstruction(
    lpMint.publicKey,
    9, // decimals
    authority, // mintAuthority
    null // freezeAuthority
  );

  // 5) feeVault / poolVault (mint = LP, owner = authority / fee지갑)
  const feeVault = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    lpMint.publicKey,
    payer.publicKey // 수수료 받을 지갑
  );
  const poolVault = await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    lpMint.publicKey,
    authority
  );

  /* ---------- 풀 초기화 Instruction ---------- */
  const initIx = TokenSwap.createInitSwapInstruction(
    swap, // tokenSwapAccount
    authority, // authority
    tokenAccountA.address, // tokenAccountA
    tokenAccountB.address, // tokenAccountB
    lpMint.publicKey, // tokenPool (LP Mint)
    feeVault.address, // feeAccount
    poolVault.address, // tokenAccountPool (LP 보관용)
    TOKEN_PROGRAM_ID, // SPL Token Program
    TOKEN_SWAP_PROGRAM_ID, // Swap Program
    tradeFee, // tradeFeeNumerator
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

  const tx = new Transaction()
    .add(createLpMintIx, initLpMintIx) // LP Mint 계정 생성 & 초기화
    .add(transferA, transferB) // 초기 유동성
    .add(initIx); // 풀 초기화

  tx.feePayer = payer.publicKey;

  const sig = await sendAndConfirmTransaction(conn, tx, [payer, lpMint, swap], {
    commitment: "confirmed",
  });
  console.log("Swap pool created!");
  console.log("signature:", sig);
})();
