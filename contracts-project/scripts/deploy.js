#!/usr/bin/env node
// Deploys AgentSeal. TESTNET FIRST — this script refuses mainnet unless
// CONFIRM_MAINNET=YES is set explicitly in the environment.
//
// Required env:
//   RPC_URL          e.g. https://data-seed-prebsc-1-s1.binance.org:8545 (BSC testnet)
//                        https://bsc-dataseed.binance.org            (BSC mainnet)
//   PRIVATE_KEY      deployer key (use a dedicated, minimally-funded wallet)
// Optional env:
//   AGENT_ID_ADDRESS defaults to the real SPACE ID Agent ID on BSC mainnet:
//                    0x60b9262456de011f7d15a54cdd8c48baaa8b022f
//                    On testnet there is no official Agent ID contract —
//                    deploy MockAgentID yourself and pass its address here
//                    (testnet deployments are rehearsal only).
//   CONFIRM_MAINNET  must equal "YES" when RPC_URL points at BSC mainnet (chainId 56).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const MAINNET_AGENT_ID = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

async function main() {
  const { RPC_URL, PRIVATE_KEY } = process.env;
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Missing RPC_URL or PRIVATE_KEY (see .env.example). Aborting.");
    process.exit(1);
  }
  const agentIdAddress = process.env.AGENT_ID_ADDRESS || MAINNET_AGENT_ID;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Network chainId: ${chainId}`);

  if (chainId === 56 && process.env.CONFIRM_MAINNET !== "YES") {
    console.error("Refusing to deploy to BSC MAINNET without CONFIRM_MAINNET=YES.");
    process.exit(1);
  }
  if (chainId === 56 && agentIdAddress.toLowerCase() !== MAINNET_AGENT_ID.toLowerCase()) {
    console.error("Mainnet deploy must use the official Agent ID contract. Aborting.");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}  balance: ${ethers.formatEther(balance)} BNB`);
  if (balance === 0n) {
    console.error("Deployer has zero balance — fund it (testnet faucet for chainId 97) first. Aborting.");
    process.exit(1);
  }

  const artifact = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "AgentSeal.json"), "utf8")
  );
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log(`Deploying AgentSeal with Agent ID gate at ${agentIdAddress} ...`);
  const contract = await factory.deploy(agentIdAddress);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  console.log(`AgentSeal deployed: ${address}`);
  console.log(`Deploy tx: ${tx ? tx.hash : "(unknown)"}`);
  console.log(
    chainId === 97
      ? `Verify: https://testnet.bscscan.com/address/${address}`
      : `Verify: https://bscscan.com/address/${address}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
