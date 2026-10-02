// Regenerates lib/abis.ts from Foundry build output. Run after `forge build`:
//   node scripts/gen-abis.mjs
import { readFileSync, writeFileSync } from "node:fs";

const contracts = ["VyraLocking", "VyraRewardPool", "MockVyraNFT", "MockToken"];
const abiOf = (name) =>
  JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8")).abi;

let out = "// Generated from contracts/out by scripts/gen-abis.mjs — do not edit.\n\n";
for (const name of contracts) {
  const id = name[0].toLowerCase() + name.slice(1) + "Abi";
  out += `export const ${id} = ${JSON.stringify(abiOf(name), null, 2)} as const;\n\n`;
}
writeFileSync("lib/abis.ts", out);
console.log(`lib/abis.ts: ${contracts.length} ABIs written`);
