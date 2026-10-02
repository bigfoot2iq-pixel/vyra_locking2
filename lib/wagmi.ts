import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import type { Chain } from "viem";
import { createConfig, http } from "wagmi";
import { mock } from "wagmi/connectors";
import { anvil } from "viem/chains";
import { activeChain, walletConnectProjectId } from "./env";

// WalletConnect-based wallets need a project id; without one, fall back to browser wallets only.
const wallets = walletConnectProjectId
  ? [rabbyWallet, metaMaskWallet, okxWallet, coinbaseWallet, walletConnectWallet]
  : [injectedWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "VYRA · The Keep",
  projectId: walletConnectProjectId || "vyra-keep",
});

const chain: Chain = activeChain;

// Local anvil: expose the first unlocked dev account (see DevAutoConnect, `?dev`).
const devConnectors =
  chain.id === anvil.id ? [mock({ accounts: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"], features: { reconnect: true } })] : [];

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [...connectors, ...devConnectors],
  transports: { [chain.id]: http() },
  ssr: true,
});
