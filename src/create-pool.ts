import {
  TokenSwap,
  CurveType,
  TOKEN_SWAP_PROGRAM_ID,
  TokenSwapLayout,
} from "@solana/spl-token-swap";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
} from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";

function loadKeypairFromFile(filePath: string, strict?: boolean): Keypair {
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

/* ---------- CLI 플래그 ---------- */
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("trade-fee", { type: "number", default: 25 }) // 0.25 %
    .option("payer-keypair", { type: "string", demandOption: true })
    .option("swap-key-dir", { type: "string", demandOption: true })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  /* ---------- 기본 설정 ---------- */
  const keysPath = argv["swap-key-dir"];
  const payerKeyPath = argv["payer-keypair"];
  const tradeFee = BigInt(argv["trade-fee"]); // 0.25% = 25

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

  /* Initialize Environment & Variables */
  const conn = new Connection(argv.url, "confirmed");
  const payer = loadKeypairFromFile(payerKeyPath, true); // Payer Vault 어카운트
  let signature: string;
  const tokenVaultMintAmount = 1_000_000_000n; // 10^9 (1억) 개
  console.log(`TOKEN_PROGRAM_ID: ${TOKEN_PROGRAM_ID.toBase58()}`);
  console.log(`TOKEN_SWAP_PROGRAM_ID: ${TOKEN_SWAP_PROGRAM_ID.toBase58()}`);

  // 1. create token A, B
  console.log(`\n\x1b[34m1. Creating Token A and B...\x1b[0m`);
  const mintA = await createMint(
    conn, // 연결된 Solana 클러스터
    payer, // 이 계정이 Mint 권한을 가짐
    payer.publicKey, // mintAuthority는 이 계정
    payer.publicKey, // freezeAuthority는 이 계정
    9, // 소수점 자리수 (decimals)
    undefined,
    undefined,
    TOKEN_PROGRAM_ID // Solana의 기본 SPL 토큰 프로그램
  );
  console.log("🍎 Token Apple Mint:", mintA.toBase58());

  const mintB = await createMint(
    conn,
    payer,
    payer.publicKey,
    payer.publicKey,
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log("🍌 Token Banana Mint:", mintB.toBase58());

  // 2. create keypair for Token Swap
  console.log(`\n\x1b[34m2. Creating Token Swap Keypair...\x1b[0m`);
  const swap = loadKeypairFromFile(`${keysPath}/swap.json`); // Token Swap 어카운트

  // 3. get authority PDA from Token Swap
  console.log(`\n\x1b[34m3. Getting Authority PDA for Token Swap...\x1b[0m`);
  const [authorityPDA, authorityBump] = PublicKey.findProgramAddressSync(
    [swap.publicKey.toBuffer()],
    TOKEN_SWAP_PROGRAM_ID
  );
  console.log("🔑 Authority PDA:", authorityPDA.toBase58());

  // 4. Vault A, Vault B 계정 생성
  console.log(`\n\x1b[34m4. Creating Vaults for Token A and B...\x1b[0m`);
  const tokenAPubKey = new PublicKey(mintA);
  const tokenBPubKey = new PublicKey(mintB);

  const vaultA = await getOrCreateAssociatedTokenAccount(
    conn,
    payer, // 수수료 지불 + 초기 토큰 제공
    tokenAPubKey, // A 토큰 Mint
    authorityPDA, // owner (PDA)
    true // allowOwnerOffCurve: true (PDA가 소유자)
  );
  console.log("🔒 Apple Vault(A):", vaultA.address.toBase58());

  const vaultB = await getOrCreateAssociatedTokenAccount(
    conn,
    payer, // 수수료 지불 + 초기 토큰 제공
    tokenBPubKey, // B 토큰 Mint
    authorityPDA, // owner (PDA)
    true // allowOwnerOffCurve: true (PDA가 소유자)
  );
  console.log("🔒 Banana Vault(B):", vaultB.address.toBase58());

  // 5. Vault A, B로 Apple, Banana 각각 발행
  console.log(`\n\x1b[34m5. Minting Tokens to Vaults...\x1b[0m`);
  signature = await mintToChecked(
    conn,
    payer, // 민트 authority 키 (payer가 민트 권한을 가짐)
    tokenAPubKey,
    vaultA.address, // Vault A로 민트
    payer, // payer가 수수료 지불
    tokenVaultMintAmount, // 발행량
    9 // decimals
  );
  console.log(
    `Minted ${tokenVaultMintAmount} 🍎 → Vault A, signature:`,
    signature
  );

  signature = await mintToChecked(
    conn,
    payer, // 민트 authority 키 (payer가 민트 권한을 가짐)
    tokenBPubKey,
    vaultB.address, // Vault B로 민트
    payer, // payer가 수수료 지불
    tokenVaultMintAmount, // 발행량
    9 // decimals
  );
  console.log(
    `Minted ${tokenVaultMintAmount} 🍌 → Vault B, signature:`,
    signature
  );

  // 6. create LP Token
  console.log(`\n\x1b[34m6. Creating LP Token Mint...\x1b[0m`);
  const mintLP = await createMint(
    conn,
    payer, // 이 계정이 LP Mint 권한을 가짐
    authorityPDA, // mintAuthority는 authority PDA
    null, // freezeAuthority는 없음
    9, // LP Token의 소수점 자리수 (decimals)
    undefined,
    undefined,
    TOKEN_PROGRAM_ID // Solana의 기본 SPL 토큰 프로그램
  );
  console.log("💳 LP Token Mint:", mintLP.toBase58());

  // 7. create Pool Vault
  console.log(`\n\x1b[34m7. Creating Pool Vault for LP Token...\x1b[0m`);
  const poolVault = await getOrCreateAssociatedTokenAccount(
    conn,
    payer, // 수수료 지불 + 초기 LP Token 제공
    mintLP, // LP Token Mint
    payer.publicKey, // owner (PDA)
    true // allowOwnerOffCurve: true (PDA가 소유자)
  );
  console.log("🔒 Pool Vault:", poolVault.address.toBase58());

  // 8. create Fee Owner Key Pair & Vault
  console.log(
    `\n\x1b[34m8. Creating Fee Owner Keypair & Fee Vault for LP Token...\x1b[0m`
  );
  const feeOwner = loadKeypairFromFile(`${keysPath}/fee-owner.json`); // 수수료 소유자 어카운트
  const feeVault = await createAccount(
    conn,
    payer, // 수수료 지불 + 초기 LP Token 제공
    mintLP, // LP Token Mint
    feeOwner.publicKey // owner (PDA)
  );
  console.log("🔒 Fee Vault:", feeVault.toBase58());

  // 9. create Token Swap Pool
  console.log(`\n\x1b[34m9. Creating Token Swap Pool...\x1b[0m`);

  // 9‑A. swap 계정 만들기 (rent‑exempt, 프로그램 소유)
  const swapRent = await conn.getMinimumBalanceForRentExemption(
    TokenSwapLayout.span
  );
  console.log("Swap Rent Exemption:", swapRent);

  const createSwapAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: swap.publicKey,
    lamports: swapRent,
    space: TokenSwapLayout.span,
    programId: TOKEN_SWAP_PROGRAM_ID,
  });
  console.log("🔨 Creating Token Swap Account...");

  const initIx = TokenSwap.createInitSwapInstruction(
    swap, // tokenSwapAccount
    authorityPDA, // authority
    vaultA.address, // tokenAccountA
    vaultB.address, // tokenAccountB
    mintLP, // tokenPool (LP Mint)
    feeVault, // feeAccount
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
  console.log("🔧 Initializing Token Swap Pool...");

  const tx = new Transaction().add(createSwapAccountIx).add(initIx);
  tx.feePayer = payer.publicKey;

  try {
    console.log("⏳ Sending transaction to create Token Swap Pool...");
    signature = await sendAndConfirmTransaction(conn, tx, [payer, swap], {
      commitment: "confirmed",
    });
    console.log("✅ Token Swap Pool created, signature:", signature);
  } catch (err) {
    console.error("❌ Failed to create Token Swap Pool:", err.message);
    if (err instanceof SendTransactionError) {
      console.log(err.transactionError);
    }
  }
})();
