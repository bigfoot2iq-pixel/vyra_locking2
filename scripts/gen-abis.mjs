// Regenerates lib/abis.ts from the Foundry build output, so the app always uses the compiler's ABIs:
//   npm run abis          compile the contracts, then write lib/abis.ts
//   npm run abis:check    compile, then fail if lib/abis.ts differs from the build
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Foundry's forge, not another `forge` that may come first on PATH
const bin = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry", "bin");
const forge = ["forge.exe", "forge"].map((f) => join(bin, f)).find(existsSync) ?? "forge";
execFileSync(forge, ["build"], { cwd: "contracts", stdio: "inherit" });

const contracts = ["VyraLocking", "VyraRewardPool", "MockVyraNFT", "MockToken"];
const abiOf = (name) =>
  JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8")).abi;

let out = "// Generated from contracts/out by scripts/gen-abis.mjs — do not edit.\n\n";
for (const name of contracts) {
  const id = name[0].toLowerCase() + name.slice(1) + "Abi";
  out += `export const ${id} = ${JSON.stringify(abiOf(name), null, 2)} as const;\n\n`;
}

if (process.argv.includes("--check")) {
  const current = readFileSync("lib/abis.ts", "utf8").replace(/\r\n/g, "\n");
  if (current !== out) {
    console.error("lib/abis.ts is out of date with the contracts. Run `npm run abis`.");
    process.exit(1);
  }
  console.log("lib/abis.ts matches the compiled contracts");
} else {
  writeFileSync("lib/abis.ts", out);
  console.log(`lib/abis.ts: ${contracts.length} ABIs written`);
}
