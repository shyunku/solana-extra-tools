// pda-find.ts
//
// 사용법:
//   npx ts-node pda-find.ts \
/*      --program-id SwapsVeCiPHMUAtzQWZw7RjsKjgCjhwU55QGu4U1Szw \
        --seed 3HL9AhtV9H4HBCcYhL5N3Pg1gMCwqA8ReMmBZzjG7BWP      */

import { PublicKey } from "@solana/web3.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { getSeedBuffer } from "./util";

(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("program-id", { type: "string", demandOption: true })
    .option("seed", { type: "string", demandOption: true })
    .strict()
    .parse();

  const programId = new PublicKey(argv["program-id"]);

  /* seed 는 pubkey 문자열·ASCII 문자열·hex 문자열 어떤 것이든
     Buffer 로 변환한 뒤 배열 한 칸에 넣으면 됩니다.             */
  let seedBuf: Buffer = getSeedBuffer(argv["seed"]);
  const [pda, bump] = PublicKey.findProgramAddressSync([seedBuf], programId);

  console.log("✅ PDA :", pda.toBase58());
  console.log("〽️ Bump:", bump);
})();
