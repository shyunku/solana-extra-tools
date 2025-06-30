import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { OpenBookV2Client } from "@openbook-dex/openbook-v2";
import * as anchor from "@coral-xyz/anchor";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { loadKeypairFromFile } from "./util";

(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("payer", { type: "string", demandOption: true })
    .option("base-mint", { type: "string", demandOption: true })
    .option("quote-mint", { type: "string", demandOption: true })
    .option("program-id", { type: "string", demandOption: true })
    .option("base-lot", { type: "number", default: 1_000_000 }) // 10-6
    .option("quote-lot", { type: "number", default: 1_000 }) // 10-3
    .option("maker-fee", { type: "number", default: 25 })
    .option("taker-fee", { type: "number", default: 25 })
    .option("time-expiry", { type: "number", default: 0 })
    .option("oracle", { type: "string", default: null })
    .option("admin", { type: "string", default: null })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  const payerKeyPath = argv["payer"];
  const programId = new PublicKey(argv["program-id"]);
  const baseMint = new PublicKey(argv["base-mint"]);
  const quoteMint = new PublicKey(argv["quote-mint"]);

  const payer = loadKeypairFromFile(payerKeyPath, true);

  const conn = new Connection(argv.url, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });

  /* 필수 lotSize 계산
   - lotSize = 최소 호가 단위
   - 예: 0.001 APPLE, 0.000001 BANANA */
  const baseLot = new anchor.BN(argv["base-lot"]); // 10-6 * 10^9 = 0.000001
  const quoteLot = new anchor.BN(argv["quote-lot"]); // 10-3 * 10^9 = 0.001

  /* maker / taker 수수료 (bps × 10^4)
   0 bps → new BN(0)  */
  const makerFee = new anchor.BN(argv["maker-fee"] * 100); // 0.25% = 25 bps
  const takerFee = new anchor.BN(argv["taker-fee"] * 100); // 0.25% = 25 bps

  /* timeExpiry
   - 0 = 영구 마켓
   - 특정 시점 이후 자동 종료하려면 unixTimestamp 입력 */
  const timeExpiry = new anchor.BN(argv["time-expiry"]);

  /* Oracle·관리자 계정: 없으면 null */
  const oracle = argv["oracle"] === null ? null : new PublicKey(argv["oracle"]);
  const admin = argv["admin"] === null ? null : new PublicKey(argv["admin"]);

  const ob = new OpenBookV2Client(provider, programId);

  const [ixs, signers] = await ob.createMarketIx(
    payer.publicKey,
    "name",
    quoteMint,
    baseMint,
    quoteLot,
    baseLot,
    makerFee,
    takerFee,
    timeExpiry,
    oracle, // oracleA
    oracle, // oracleB
    admin, // openOrdersAdmin
    admin, // consumeEventsAdmin
    admin, // closeMarketAdmin
    /* oracleConfigParams? */ undefined,
    /* market Keypair?     */ undefined, // 자동 생성
    /* collectFeeAdmin?    */ admin
  );
  if (ixs.length === 0) {
    throw new Error("No instructions generated for market creation");
  }

  // signers 배열에서 새로 생성된 Market의 Keypair를 가져옵니다.
  if (signers.length === 0) {
    throw new Error("Market keypair was not returned in signers array.");
  }
  const marketKeypair = signers[0] as Keypair;
  const marketId = marketKeypair.publicKey;

  const tx = new Transaction().add(...ixs);
  const sig = await provider.sendAndConfirm(tx, signers);

  console.log("📈 Market created successfully!");
  console.log("   - Market ID:", marketId.toBase58());
  console.log("   - Transaction Signature:", sig);
})();
