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
import {
  ensureAta,
  ensureBalance,
  loadKeypairFromFile,
  readAddressFromFile,
} from "./util";

class Victim {
  public keypair: Keypair;
  public aBalance: BigInt;
  public bBalance: BigInt;

  private tokenA!: { ata: PublicKey };
  private tokenB!: { ata: PublicKey };

  constructor(
    private conn: Connection,
    public name: string,
    keyPairPath: string
  ) {
    this.keypair = loadKeypairFromFile(keyPairPath);
  }

  /** 초기화: ATA 확보 + 잔고 확보 */
  async init(
    mintA: PublicKey,
    mintB: PublicKey,
    mintAmt: bigint,
    payer: Keypair
  ) {
    this.tokenA = {
      ata: (await ensureAta(this.conn, payer, mintA, this.keypair.publicKey))
        .address,
    };
    this.tokenB = {
      ata: (await ensureAta(this.conn, payer, mintB, this.keypair.publicKey))
        .address,
    };
    await ensureBalance(this.conn, payer, mintA, this.tokenA.ata, mintAmt);
    await ensureBalance(this.conn, payer, mintB, this.tokenB.ata, mintAmt);
  }

  async trade(
    direction: "AtoB" | "BtoA",
    amount: bigint,
    params: {
      swap: PublicKey;
      authority: PublicKey;
      vaultA: PublicKey;
      vaultB: PublicKey;
      mintA: PublicKey;
      mintB: PublicKey;
      lpMint: PublicKey;
      feeVault: PublicKey;
      payer: Keypair;
    }
  ) {
    const {
      swap,
      authority,
      vaultA,
      vaultB,
      mintA,
      mintB,
      lpMint,
      feeVault,
      payer,
    } = params;

    const userSource = direction === "AtoB" ? this.tokenA.ata : this.tokenB.ata;
    const userDest = direction === "AtoB" ? this.tokenB.ata : this.tokenA.ata;
    const poolSource = direction === "AtoB" ? vaultA : vaultB;
    const poolDest = direction === "AtoB" ? vaultB : vaultA;
    const sourceMint = direction === "AtoB" ? mintA : mintB;
    const destMint = direction === "AtoB" ? mintB : mintA;

    const ix = TokenSwap.swapInstruction(
      swap,
      authority,
      this.keypair.publicKey, // userTransferAuthority
      userSource,
      poolSource,
      poolDest,
      userDest,
      lpMint,
      feeVault,
      null, // host fee
      sourceMint,
      destMint,
      TOKEN_SWAP_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      amount,
      0n // min out
    );

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.conn, tx, [payer, this.keypair]);
  }

  /** 무한 루프 */
  async tradeLoop(loopParams: any) {
    const { intervalMs, minAmt, maxAmt } = loopParams;
    const amountRange = Number(maxAmt - minAmt);

    while (true) {
      const dir = Math.random() > 0.5 ? "AtoB" : "BtoA";
      const amt =
        minAmt + BigInt(Math.floor(Math.random() * (amountRange + 1)));

      try {
        await this.trade(dir, amt, loopParams);
        console.log(`[${this.name}] ${dir} ${amt}`);
      } catch (e) {
        console.error(`[${this.name}] trade fail`, e);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
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
      description: "AMM 풀 키/주소 파일이 저장된 디렉토리 경로",
      demandOption: true,
    })
    .option("victims", {
      alias: "v",
      type: "number",
      description: "생성할 victim 수",
      default: 5,
    })
    .option("minting", {
      alias: "m",
      type: "number",
      description: "victim 각각에게 mint할 A, B 토큰 수",
      default: 1e4,
    })
    .option("min-trade-amount", {
      type: "number",
      description: "victim 각각이 한 번의 거래에 스왑하는 최소 토큰 수",
      default: 1,
    })
    .option("max-trade-amount", {
      type: "number",
      description: "victim 각각이 한 번의 거래에 스왑하는 최대 토큰 수",
      default: 1e2,
    })
    .option("min-trade-interval", {
      type: "number",
      description: "victim 각각에 대해 거래되는 최소 period ms",
      default: 1000,
    })
    .option("max-trade-interval", {
      type: "number",
      description: "victim 각각에 대해 거래되는 최대 period ms",
      default: 5000,
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
  const victimCount = argv.victims;
  const minTradeInterval = argv.minTradeInterval;
  const maxTradeInterval = argv.maxTradeInterval;
  const minTradeAmount = BigInt(argv.minTradeAmount * 1e9);
  const maxTradeAmount = BigInt(argv.maxTradeAmount * 1e9);
  const minting = BigInt(argv.minting * 1e9);

  console.log(`Initial setting: `, argv);

  if (victimCount <= 0) throw new Error(`Victim count is not valid`);
  if (minting <= minTradeAmount)
    throw new Error(`Minting should be bigger than minTradeAmount`);
  if (minting >= maxTradeAmount)
    throw new Error(`Minting should be smaller than maxTradeAmount`);
  if (maxTradeInterval < minTradeInterval)
    throw new Error(`minTradeInterval should be smaller than maxTradeInterval`);

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

  /* ---------- 2. Victim 키페어 로드 (없으면 생성) ---------- */
  const victims: Victim[] = [];
  for (let i = 0; i < victimCount; i++) {
    const name = `victim_${String(victimCount).padStart(3, "0")}`;
    const victim = new Victim(connection, name, `${argv.keyDir}/${name}.json`);
    await victim.init(mintAAddress, mintBAddress, minting, payer);
    victims.push(victim);
  }

  /* ---------- 3. Victim Trade Loop 시작 ---------- */
  victims.forEach((v) =>
    v.tradeLoop({
      intervalMsFunc: () =>
        minTradeInterval +
        Math.random() * (maxTradeInterval - minTradeInterval),
      minAmt: minTradeAmount,
      maxAmt: maxTradeAmount,
      swap: swapAccountAddress,
      authority: authorityPDAAddress,
      vaultA: vaultAAddress,
      vaultB: vaultBAddress,
      mintA: mintAAddress,
      mintB: mintBAddress,
      lpMint: lpMintAddress,
      feeVault: feeAccountAddress,
      payer,
    })
  );

  // infinite await
  await new Promise(() => {});
})();
