# VYRA · The Keep

NFT locking and daily-reward dApp for the [VYRA](https://www.vyranfts.xyz/) guardians on Ink. Holders lock a guardian with tokens, the tokens go to a self-funding reward pool, and holders claim a daily tribute from it.

- `contracts/`: Foundry project (`VyraLocking` + `VyraRewardPool`). See [contracts/README.md](contracts/README.md) for the rules and the pool security model.
- `app/`, `components/`, `hooks/`, `lib/`: Next.js 16 frontend (wagmi 2, viem, RainbowKit).
  - `/`: The Keep: lock (with level picker), level up a running lock, daily vigil track, claim, renew, unlock.
  - `/admin`: Council: all owner config. Only visible to the locking contract owner, or to signers of the owner Safe (buttons then copy Safe calldata). Everyone else is redirected to `/`. The contracts enforce `onlyOwner` regardless.

## Run locally

```sh
npm install
# terminal 1
anvil
# terminal 2: deploy mocks + demo state (locks mid-period, one at Level 2)
bash scripts/seed-local.sh
# copy addresses from contracts/deployments/31337.json into .env.local (see .env.example)
npm run dev
```

Local chain only (anvil):
- `/?dev` auto-connects the anvil dev account. It signs **without a wallet prompt**, so every click sends a real transaction.
- `/?rite=lock|renew|levelup` previews the ceremony overlay.

## Config

See `.env.example`. Chain `ink` | `inkSepolia` | `anvil`. USD hints come from DexScreener on mainnet, or `NEXT_PUBLIC_TOKEN_USD_PRICE` on testnets. They are display only; contracts use token amounts.
