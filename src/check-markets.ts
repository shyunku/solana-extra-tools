// check-gpa.ts
import { Connection, PublicKey } from "@solana/web3.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function checkGpa() {
  const argv = await yargs(hideBin(process.argv))
    .option("program-id", { type: "string", demandOption: true })
    .option("url", { type: "string", default: "http://127.0.0.1:8899" })
    .strict()
    .parse();

  const programID = new PublicKey(argv["program-id"]);
  const rpcURL = argv["url"];

  const connection = new Connection(rpcURL, "confirmed");

  console.log(
    `Requesting getProgramAccounts for program: ${programID.toBase58()}`
  );

  try {
    // 가장 단순한 형태의 getProgramAccounts 호출 (필터 없음)
    const accounts = await connection.getProgramAccounts(programID);

    console.log(
      `✅ SUCCESS! getProgramAccounts returned ${accounts.length} accounts.`
    );

    if (accounts.length > 0) {
      console.log("Found accounts. The index seems to be working.");
      // 여기서부터 findAllMarkets와 유사하게 직접 디코딩 가능
    } else {
      console.log(
        "⚠️ Found 0 accounts. The validator's index for this program is likely not ready or empty."
      );
    }
  } catch (e) {
    console.error("❌ ERROR during getProgramAccounts call:", e);
  }
}

checkGpa();
