// check-market-status.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { OpenBookV2Client } from "@openbook-dex/openbook-v2";
import * as anchor from "@coral-xyz/anchor";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { loadKeypairFromFile } from "./util";

async function checkMarket() {
  const argv = await yargs(hideBin(process.argv))
    .option("payer", { type: "string", demandOption: true })
    .option("market-id", { type: "string", demandOption: true })
    .option("program-id", { type: "string", demandOption: true })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  const payerKeyPath = argv["payer"];
  const marketID = new PublicKey(argv["market-id"]);
  const programID = new PublicKey(argv["program-id"]);
  const rpcURL = argv["url"];

  const payer = loadKeypairFromFile(payerKeyPath, true);

  const conn = new Connection(rpcURL, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });
  const client = new OpenBookV2Client(provider, programID);

  console.log(`Checking market: ${marketID.toBase58()}`);
  const market = await client.program.account.market.fetch(marketID);

  if (!market) {
    console.log("Market not found!");
    return;
  }

  console.log("\n--- Decoded Market Data ---");
  console.log("Market Name:", market.name);
  console.log("Base Mint:", market.baseMint.toBase58());
  console.log("Quote Mint:", market.quoteMint.toBase58());

  // 핵심 확인 부분!
  console.log("Time Expiry (BN):", market.timeExpiry.toString());
  const expiryTimestamp = market.timeExpiry.toNumber();
  if (expiryTimestamp === 0) {
    console.log("✅ Status: Perpetual (Never expires)");
  } else {
    console.log(
      `❌ Status: Expires at ${new Date(expiryTimestamp * 1000).toUTCString()}`
    );
    if (Date.now() > expiryTimestamp * 1000) {
      console.log("   (This market has already expired!)");
    }
  }
}

checkMarket().catch((err) => console.error(err));
