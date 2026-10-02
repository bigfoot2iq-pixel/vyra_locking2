// Builds lib/guardian-images.json: token id -> MD5 of its image file.
// OpenSea's CDN names every image by that hash:
//   https://i2c.seadn.io/ink/<nft>/<md5 minus first 2 chars>/<md5>.png
// so the app can load art from OpenSea instead of rate-limited public IPFS gateways.
//
//   node scripts/build-image-map.mjs            (resumes; only fetches missing ids)
//   GATEWAY=https://my.gateway/ipfs node scripts/build-image-map.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const META_CID = "QmZa81PrGdYzjuv33Numr3iRTAiRynDZ8x5uhcRqBHqMrR";
const SUPPLY = 1111;
const GATEWAY = process.env.GATEWAY ?? "https://gateway.pinata.cloud/ipfs";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);
const OUT = new URL("../lib/guardian-images.json", import.meta.url);

const map = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const save = () =>
  writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a], [b]) => a - b))) + "\n");

const ipfs = (uri) => `${GATEWAY}/${uri.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "")}`;

async function retry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

async function hashOf(id) {
  const meta = await retry(async () => {
    const r = await fetch(ipfs(`${META_CID}/${id}`), { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`meta ${id}: HTTP ${r.status}`);
    return r.json();
  });
  return retry(async () => {
    const r = await fetch(ipfs(meta.image), { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`image ${id}: HTTP ${r.status}`);
    const h = createHash("md5");
    for await (const chunk of r.body) h.update(chunk);
    return h.digest("hex");
  });
}

const todo = Array.from({ length: SUPPLY }, (_, i) => i + 1).filter((id) => !map[id]);
console.log(`${SUPPLY - todo.length} cached, ${todo.length} to fetch via ${GATEWAY}`);

let done = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let id; (id = todo.shift()) !== undefined; ) {
      try {
        map[id] = await hashOf(id);
      } catch (e) {
        failed++;
        console.error(String(e));
      }
      if (++done % 25 === 0) {
        save();
        console.log(`${done} / ${done + todo.length}`);
      }
    }
  }),
);
save();
console.log(`done: ${Object.keys(map).length} / ${SUPPLY} mapped, ${failed} failed (rerun to retry)`);
