// Builds the on-chain rarity map from the collection's metadata.
//   node scripts/build-rarity.mjs <metadata-dir>
//   node scripts/build-rarity.mjs <opensea.csv>
// <metadata-dir> holds files named 1..1111 (the unpacked IPFS folder of the VYRA tokenURIs).
// <opensea.csv> is the OpenSea upload sheet: a `tokenID` and an `attributes[Rarity]` column.
// Writes contracts/data/vyra-rarity.json: per-id tiers, counts, and the packed words the
// contract stores (4 bits per token, 64 tokens per uint256 word).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const SUPPLY = 1111;
const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/build-rarity.mjs <metadata-dir | opensea.csv>");

/** RFC 4180 rows: quoted fields may hold commas, newlines and "" escapes. */
function parseCsv(text) {
  const rows = [[]];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") rows.at(-1).push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.at(-1).push(field), (field = ""), rows.push([]);
    } else field += c;
  }
  rows.at(-1).push(field);
  return rows.filter((r) => r.some((f) => f !== ""));
}

/** [id, Rarity value] for every token in the source. */
function* entries() {
  if (src.toLowerCase().endsWith(".csv")) {
    const [head, ...rows] = parseCsv(readFileSync(src, "utf8").replace(/^﻿/, ""));
    const idCol = head.indexOf("tokenID");
    const rarityCol = head.indexOf("attributes[Rarity]");
    if (idCol < 0 || rarityCol < 0) throw new Error("CSV needs tokenID and attributes[Rarity] columns");
    for (const r of rows) yield [Number(r[idCol]), r[rarityCol].trim()];
    return;
  }
  for (const f of readdirSync(src)) {
    const meta = JSON.parse(readFileSync(`${src}/${f}`, "utf8"));
    yield [Number(f.replace(/\.json$/, "")), meta.attributes?.find((a) => a.trait_type === "Rarity")?.value];
  }
}

const tiers = new Array(SUPPLY + 1).fill(0);
const counts = Object.fromEntries(TIERS.map((t) => [t, 0]));
const seen = new Set();
for (const [id, value] of entries()) {
  if (!Number.isInteger(id) || id < 1 || id > SUPPLY) continue;
  if (seen.has(id)) throw new Error(`token ${id} listed twice`);
  const tier = TIERS.indexOf(value);
  if (tier < 0) throw new Error(`token ${id}: unknown Rarity "${value}"`);
  tiers[id] = tier;
  counts[value]++;
  seen.add(id);
}
if (seen.size !== SUPPLY) throw new Error(`expected ${SUPPLY} tokens, found ${seen.size}`);

const words = [];
for (let id = 0; id <= SUPPLY; id++) {
  const w = Math.floor(id / 64);
  words[w] = (words[w] ?? 0n) | (BigInt(tiers[id]) << BigInt((id % 64) * 4));
}

writeFileSync(
  "contracts/data/vyra-rarity.json",
  JSON.stringify(
    {
      source: "Rarity trait of ipfs://QmZa81PrGdYzjuv33Numr3iRTAiRynDZ8x5uhcRqBHqMrR/{id}",
      tiers: TIERS,
      counts,
      words: words.map((w) => "0x" + w.toString(16).padStart(64, "0")),
      byId: Object.fromEntries(tiers.slice(1).map((t, i) => [i + 1, TIERS[t]])),
    },
    null,
    2,
  ) + "\n",
);
console.log(counts, `${words.length} words`);
