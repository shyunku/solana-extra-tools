import { TOKEN_SWAP_PROGRAM_ID, TokenSwap } from "@solana/spl-token-swap";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";
import path from "path";
import { loadKeypairFromFile, readAddressFromFile } from "./util";

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
      description: "AMM 풀 키/주소 파일이 저장된 디렉토리 경로",
      demandOption: true,
    })
    .option("amount-a", {
      alias: "a",
      type: "number",
      description: "스왑할 토큰 A의 양",
    })
    .option("amount-b", {
      alias: "b",
      type: "number",
      description: "스왑할 토큰 B의 양",
    })
    .option("url", {
      alias: "u",
      type: "string",
      description: "Solana RPC 노드 URL",
      default: "http://127.0.0.1:8899",
    })
    .strict()
    .parse();

  /* ---------- 기본 설정 및 변수 초기화 ---------- */
  const connection = new Connection(argv.url, "confirmed");
  const payer = loadKeypairFromFile(argv.payer);
  // 커맨드라인에서 받은 숫자를 BigInt와 9자리 소수점으로 변환
  if (!argv.amountA && !argv.amountB) {
    throw new Error(`amountA or amountB should be given`);
  }

  const amountA =
    argv.amountA === 0 || isNaN(argv.amountA)
      ? BigInt(0)
      : BigInt(argv.amountA * 10 ** 9);
  const amountB =
    argv.amountB === 0 || isNaN(argv.amountB)
      ? BigInt(0)
      : BigInt(argv.amountB * 10 ** 9);
  console.log(`amountA=${amountA} amountB=${amountB}`);

  /* ---------- 1. key-dir에서 풀 정보 로드 ---------- */
  console.log(
    `\x1b[34m[1/4] 🔍 풀 정보 로드 중 (from ${argv.keyDir})...\x1b[0m`
  );
  // create-amm-pool.ts에서 저장한 파일들로부터 주소를 읽어옵니다.
  const swapAccountAddress = loadKeypairFromFile(
    `${argv.keyDir}/swap_account.json`,
    true
  ).publicKey;

  const mintAAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/mint_a.txt`)
  );
  const mintBAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/mint_b.txt`)
  );
  const authorityPDAAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/authority_pda.txt`)
  );
  const vaultAAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/vault_a.txt`)
  );
  const vaultBAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/vault_b.txt`)
  );
  const lpMintAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/mint_lp.txt`)
  );
  const feeAccountAddress = new PublicKey(
    readAddressFromFile(`${argv.keyDir}/vault_fee.txt`)
  );

  console.log(`   - 스왑할 풀: ${swapAccountAddress.toBase58()}`);

  /* ---------- 2. 사용자의 토큰 계정 준비 및 테스트용 토큰 민팅 ---------- */
  console.log(`\n\x1b[34m[2/4] 💰 스왑할 토큰 준비 중...\x1b[0m`);
  const userTokenAAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintAAddress,
    payer.publicKey
  );
  const userTokenBAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintBAddress,
    payer.publicKey
  );

  // 테스트를 위해 사용자에게 스왑할 만큼의 Token A/B를 즉시 민팅해줍니다.
  const sellingA = amountA > 0;
  if (sellingA) {
    await mintTo(
      connection,
      payer,
      mintAAddress,
      userTokenAAccount.address,
      payer,
      amountA
    );
    console.log(`   - 테스트용 Token A ${argv.amountA}개 민팅 완료.`);
  } else {
    await mintTo(
      connection,
      payer,
      mintBAddress,
      userTokenBAccount.address,
      payer,
      amountB
    );
    console.log(`   - 테스트용 Token B ${argv.amountB}개 민팅 완료.`);
  }

  const tokenAAccountBefore = await getAccount(
    connection,
    userTokenAAccount.address
  );
  const tokenBAccountBefore = await getAccount(
    connection,
    userTokenBAccount.address
  );
  console.log(
    `   - 스왑 전 잔액: APPLE ${tokenAAccountBefore.amount}, BANANA ${tokenBAccountBefore.amount}`
  );

  /* ---------- 3. 스왑 트랜잭션 생성 ---------- */
  console.log(`\n\x1b[34m[3/4] 🛠️ 스왑 트랜잭션 생성 중...\x1b[0m`);
  const instruction = sellingA
    ? TokenSwap.swapInstruction(
        swapAccountAddress, // 1. tokenSwap: 스왑 풀의 주소
        authorityPDAAddress, // 2. authority: 풀의 권한 PDA
        payer.publicKey, // 3. userTransferAuthority: 사용자의 공개키
        userTokenAAccount.address, // 4. userSource: 사용자의 토큰 A 계정 (주는 쪽)
        vaultAAddress, // 5. poolSource: 풀의 토큰 A 금고
        vaultBAddress, // 6. poolDestination: 풀의 토큰 B 금고
        userTokenBAccount.address, // 7. userDestination: 사용자의 토큰 B 계정 (받는 쪽)
        lpMintAddress, // 8. poolMint: LP 토큰의 민트 주소
        feeAccountAddress, // 9. feeAccount: 스왑 수수료가 쌓일 계정 (LP 제공자 몫)
        null, // 10. hostFeeAccount: (선택) 추천인 수수료 계정, 없으면 null
        mintAAddress, // 11. sourceMint: 주는 토큰(A)의 민트 주소
        mintBAddress, // 12. destinationMint: 받는 토큰(B)의 민트 주소
        TOKEN_SWAP_PROGRAM_ID, // 13. swapProgramId: 토큰 스왑 프로그램 ID
        TOKEN_PROGRAM_ID, // 14. sourceTokenProgramId: 토큰 A의 프로그램 ID
        TOKEN_PROGRAM_ID, // 15. destinationTokenProgramId: 토큰 B의 프로그램 ID
        TOKEN_PROGRAM_ID, // 16. poolTokenProgramId: LP 토큰의 프로그램 ID
        amountA, // 17. amountIn: 주는 토큰의 양
        0n // 18. minimumAmountOut: 최소한 받아야 하는 토큰의 양
      )
    : TokenSwap.swapInstruction(
        swapAccountAddress, // 1. tokenSwap: 스왑 풀의 주소
        authorityPDAAddress, // 2. authority: 풀의 권한 PDA
        payer.publicKey, // 3. userTransferAuthority: 사용자의 공개키
        userTokenBAccount.address, // 4. userSource: 사용자의 토큰 A 계정 (주는 쪽)
        vaultBAddress, // 5. poolSource: 풀의 토큰 A 금고
        vaultAAddress, // 6. poolDestination: 풀의 토큰 B 금고
        userTokenAAccount.address, // 7. userDestination: 사용자의 토큰 B 계정 (받는 쪽)
        lpMintAddress, // 8. poolMint: LP 토큰의 민트 주소
        feeAccountAddress, // 9. feeAccount: 스왑 수수료가 쌓일 계정 (LP 제공자 몫)
        null, // 10. hostFeeAccount: (선택) 추천인 수수료 계정, 없으면 null
        mintBAddress, // 11. sourceMint: 주는 토큰(A)의 민트 주소
        mintAAddress, // 12. destinationMint: 받는 토큰(B)의 민트 주소
        TOKEN_SWAP_PROGRAM_ID, // 13. swapProgramId: 토큰 스왑 프로그램 ID
        TOKEN_PROGRAM_ID, // 14. sourceTokenProgramId: 토큰 A의 프로그램 ID
        TOKEN_PROGRAM_ID, // 15. destinationTokenProgramId: 토큰 B의 프로그램 ID
        TOKEN_PROGRAM_ID, // 16. poolTokenProgramId: LP 토큰의 프로그램 ID
        amountB, // 17. amountIn: 주는 토큰의 양
        0n // 18. minimumAmountOut: 최소한 받아야 하는 토큰의 양
      );
  const transaction = new Transaction().add(instruction);

  /* ---------- 4. 트랜잭션 전송 ---------- */
  console.log(`\n\x1b[34m[4/4] 🚀 스왑 트랜잭션 전송 중...\x1b[0m`);
  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [
      payer,
    ]);
    console.log(
      `\n✅ 성공! 토큰 스왑이 완료되었습니다. 인덱서 로그를 확인하세요!`
    );
    console.log(`   - 트랜잭션 서명: ${signature}`);

    const tokenAAccountAfter = await getAccount(
      connection,
      userTokenAAccount.address
    );
    const tokenBAccountAfter = await getAccount(
      connection,
      userTokenBAccount.address
    );
    console.log(
      `   - 스왑 후 잔액: APPLE ${tokenAAccountAfter.amount}, BANANA ${tokenBAccountAfter.amount}`
    );
  } catch (err) {
    console.error("\n❌ 스왑 실패:", err);
  }
})();
