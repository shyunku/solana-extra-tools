import {
  TokenSwap,
  CurveType,
  TOKEN_SWAP_PROGRAM_ID as OFFICIAL_TOKEN_SWAP_PROGRAM_ID,
  TokenSwapLayout,
} from "@solana/spl-token-swap";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  SendTransactionError,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createMint,
} from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";
import path from "path";

// --- 헬퍼(유틸리티) 함수 ---

/**
 * 파일 경로에서 Keypair를 로드합니다. 파일이 없으면 새로 생성하여 저장합니다.
 * @param filepath - Keypair 파일의 전체 경로
 * @returns 로드되거나 생성된 Keypair
 */
function loadKeypairFromFile(filepath: string): Keypair {
  const fullPath = path.resolve(filepath);
  if (fs.existsSync(fullPath)) {
    const secretKeyString = fs.readFileSync(fullPath, { encoding: "utf8" });
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    console.log(`🔑 Keypair loaded from ${fullPath}`);
    return Keypair.fromSecretKey(secretKey);
  } else {
    const keypair = Keypair.generate();
    fs.writeFileSync(fullPath, JSON.stringify(Array.from(keypair.secretKey)));
    console.log(`✨ New keypair generated and saved to ${fullPath}`);
    return keypair;
  }
}

/**
 * 데이터를 지정된 파일에 저장합니다.
 * @param filepath - 저장할 파일의 전체 경로 (확장자 제외)
 * @param data - 저장할 데이터
 */
function saveAddressToFile(filepath: string, data: string): void {
  const fullPath = path.resolve(filepath + ".txt");
  fs.writeFileSync(fullPath, data);
  console.log(`💾 Address saved to ${fullPath}`);
}

// --- 메인 스크립트 ---
(async () => {
  /* ---------- CLI 옵션 파싱 ---------- */
  const argv = await yargs(hideBin(process.argv))
    .option("payer", {
      alias: "p",
      type: "string",
      description: "수수료 지불자(Payer)의 Keypair 파일 경로",
      demandOption: true,
    })
    .option("key-dir", {
      alias: "k",
      type: "string",
      description: "생성된 키들을 저장할 디렉토리 경로",
      demandOption: true,
    })
    .option("trade-fee", {
      type: "number",
      description: "거래 수수료 (10000분율, 예: 0.25% -> 25)",
      default: 25,
    })
    .option("url", {
      alias: "u",
      type: "string",
      description: "Solana RPC 노드 URL",
      default: "http://127.0.0.1:8899",
    })
    .option("swap-program-id", {
      type: "string",
      description:
        "사용자 정의 Token Swap Program ID. 지정하지 않으면 공식 ID 사용",
    })
    .strict()
    .parse();

  /* ---------- 기본 설정 및 변수 초기화 ---------- */
  const keysPath = argv["key-dir"];
  const tradeFee = BigInt(argv["trade-fee"]);
  const initialTokenAmount = 1_000_000_000n; // 초기 유동성으로 공급할 토큰 양 (9 소수점 기준)

  // 키 저장 디렉토리 생성
  if (!fs.existsSync(keysPath)) {
    fs.mkdirSync(keysPath, { recursive: true });
    console.log(`📂 Created keys directory: ${keysPath}`);
  }

  const connection = new Connection(argv.url, "confirmed");
  const payer = loadKeypairFromFile(argv.payer);

  const feeOwner = loadKeypairFromFile(`${keysPath}/fee_owner.json`);
  console.log(`Fee Owner: ${feeOwner.publicKey.toBase58()}`);

  // 사용할 Token Swap 프로그램 ID 결정
  const TOKEN_SWAP_PROGRAM_ID = argv.swapProgramId
    ? new PublicKey(argv.swapProgramId)
    : OFFICIAL_TOKEN_SWAP_PROGRAM_ID;

  console.log(`\n===== AMM Pool 생성 시작 =====`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`RPC URL: ${argv.url}`);
  console.log(`Token Swap Program ID: ${TOKEN_SWAP_PROGRAM_ID.toBase58()}`);
  console.log(`=============================\n`);

  /* ---------- 1. 스왑에 사용할 토큰 A, B 생성 ---------- */
  console.log(`\x1b[34m[1/8] 🪙  토큰 A, B 민트 생성 중...\x1b[0m`);
  const mintA = await createMint(connection, payer, payer.publicKey, null, 9);
  console.log(`   - Token A Mint: ${mintA.toBase58()}`);
  saveAddressToFile(`${keysPath}/mint_a`, mintA.toBase58());

  const mintB = await createMint(connection, payer, payer.publicKey, null, 9);
  console.log(`   - Token B Mint: ${mintB.toBase58()}`);
  saveAddressToFile(`${keysPath}/mint_b`, mintB.toBase58());

  /* ---------- 2. 토큰 스왑 상태 계정을 위한 Keypair 생성 ---------- */
  console.log(
    `\n\x1b[34m[2/8] 🧾  토큰 스왑 상태 계정 Keypair 생성 중...\x1b[0m`
  );
  const swapAccount = loadKeypairFromFile(`${keysPath}/swap_account.json`);
  console.log(`   - Swap Account: ${swapAccount.publicKey.toBase58()}`);

  /* ---------- 3. 스왑 프로그램의 PDA(Program Derived Address) 권한 주소 계산 ---------- */
  console.log(
    `\n\x1b[34m[3/8] 🔑  스왑 프로그램의 권한(PDA) 주소 계산 중...\x1b[0m`
  );
  const [authorityPDA, bump] = PublicKey.findProgramAddressSync(
    [swapAccount.publicKey.toBuffer()],
    TOKEN_SWAP_PROGRAM_ID
  );
  console.log(`   - Authority PDA: ${authorityPDA.toBase58()} (Bump: ${bump})`);
  saveAddressToFile(`${keysPath}/authority_pda`, authorityPDA.toBase58());

  /* ---------- 4. 토큰 A, B를 저장할 Vault(ATA) 생성 ---------- */
  // 이 Vault들의 소유자는 PDA가 됩니다.
  console.log(`\n\x1b[34m[4/8] 🏦  토큰 A, B Vault 생성 중...\x1b[0m`);
  const vaultA = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintA,
    authorityPDA,
    true
  );
  console.log(`   - Token A Vault: ${vaultA.address.toBase58()}`);
  saveAddressToFile(`${keysPath}/vault_a`, vaultA.address.toBase58());

  const vaultB = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintB,
    authorityPDA,
    true
  );
  console.log(`   - Token B Vault: ${vaultB.address.toBase58()}`);
  saveAddressToFile(`${keysPath}/vault_b`, vaultB.address.toBase58());

  /* ---------- 5. 생성된 Vault에 토큰 민팅 (초기 유동성) ---------- */
  // 실제 서비스에서는 사용자의 지갑에서 전송받지만, 여기서는 Payer가 직접 민팅합니다.
  console.log(`\n\x1b[34m[5/8] 💦  Vault에 초기 유동성 토큰 민팅 중...\x1b[0m`);
  await mintTo(
    connection,
    payer,
    mintA,
    vaultA.address,
    payer,
    initialTokenAmount
  );
  console.log(`   - Minted ${initialTokenAmount} of Token A to Vault A`);
  await mintTo(
    connection,
    payer,
    mintB,
    vaultB.address,
    payer,
    initialTokenAmount
  );
  console.log(`   - Minted ${initialTokenAmount} of Token B to Vault B`);

  /* ---------- 6. LP(유동성 공급자) 토큰 민트 생성 ---------- */
  // 이 LP 토큰의 발행 권한은 PDA가 가집니다.
  console.log(`\n\x1b[34m[6/8] 💧  LP 토큰 민트 생성 중...\x1b[0m`);
  const lpTokenMint = await createMint(
    connection,
    payer,
    authorityPDA,
    null,
    9
  );
  console.log(`   - LP Token Mint: ${lpTokenMint.toBase58()}`);
  saveAddressToFile(`${keysPath}/mint_lp`, lpTokenMint.toBase58());

  /* ---------- 7. 생성된 LP 토큰을 받을 계정 생성 ---------- */
  // 사용자가 유동성을 공급하고 LP 토큰을 받게 될 계정입니다.
  console.log(`\n\x1b[34m[7/8] 💰  Payer의 LP 토큰 계정 생성 중...\x1b[0m`);
  const lpTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    lpTokenMint,
    payer.publicKey
  );
  console.log(
    `   - Payer's LP Token Account: ${lpTokenAccount.address.toBase58()}`
  );
  saveAddressToFile(
    `${keysPath}/payer_lp_token_account`,
    lpTokenAccount.address.toBase58()
  );

  /* ---------- 7-B. 수수료 전용 Vault 생성 ---------- */
  console.log(`\n\x1b[34m[7-B] 🏦 수수료 전용 Vault 생성 중...\x1b[0m`);
  const feeVault = await getOrCreateAssociatedTokenAccount(
    connection,
    payer, // 계정 생성 비용은 여전히 payer가 지불
    lpTokenMint, // LP 토큰을 담을 계좌
    feeOwner.publicKey // !! 이 Vault의 소유자는 feeOwner
  );
  console.log(`   - Fee Vault: ${feeVault.address.toBase58()}`);
  saveAddressToFile(`${keysPath}/vault_fee`, feeVault.address.toBase58());

  /* ---------- 8. 토큰 스왑 풀 생성 트랜잭션 실행 ---------- */
  console.log(
    `\n\x1b[34m[8/8] 🚀  토큰 스왑 풀 생성 트랜잭션 전송 중...\x1b[0m`
  );

  // 스왑 풀을 생성하는 최종 트랜잭션을 구성합니다.
  // 이 트랜잭션은 두 개의 Instruction으로 구성됩니다:
  // 1. 스왑 상태 정보를 저장할 계정(`swapAccount`)을 생성합니다.
  // 2. 생성된 계정을 `spl-token-swap` 프로그램의 데이터 형식에 맞게 초기화합니다.
  const transaction = new Transaction().add(
    // Instruction 1: 스왑 상태 계정 생성
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: swapAccount.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(
        TokenSwapLayout.span
      ),
      space: TokenSwapLayout.span,
      programId: TOKEN_SWAP_PROGRAM_ID,
    }),
    // Instruction 2: 스왑 풀 초기화
    TokenSwap.createInitSwapInstruction(
      swapAccount,
      authorityPDA,
      vaultA.address,
      vaultB.address,
      lpTokenMint,
      feeVault.address, // 수수료 계정. 실제로는 별도 계정을 만들지만 여기서는 LP 계정을 활용
      lpTokenAccount.address, // 유동성 공급자가 LP 토큰을 받을 계정
      TOKEN_PROGRAM_ID,
      TOKEN_SWAP_PROGRAM_ID,
      tradeFee,
      10000n, // tradeFeeDenominator
      0n,
      0n, // ownerTradeFee
      0n,
      0n, // ownerWithdrawFee
      0n,
      0n, // hostFee
      CurveType.ConstantProduct // 가장 일반적인 AMM 커브
    )
  );

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer, swapAccount], // Payer와 새로운 스왑 계정의 서명이 필요합니다.
      { commitment: "confirmed" }
    );
    console.log(`\n✅  성공! AMM 풀이 성공적으로 생성되었습니다.`);
    console.log(`   - 트랜잭션 서명: ${signature}`);
    console.log(`   - 스왑 주소: ${swapAccount.publicKey.toBase58()}`);
  } catch (err) {
    console.error("\n❌ 풀 생성 실패:", err);
    if (err instanceof SendTransactionError) {
      console.error("Transaction Logs:", err.logs);
    }
    console.log(
      "\n실패 시 agave-validator 로그를 확인하세요: agave-validator -l"
    );
  }
})();
