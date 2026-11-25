// AgentSeal — single source of truth for deployment config.
// Everything in the frontend reads the contract address from here only.
// Leave CONTRACT_ADDRESS empty until the mainnet deploy is done, then paste
// the deployed AgentSeal address (checksummed) — no other file needs editing.
window.AGENTSEAL_CONFIG = {
  CONTRACT_ADDRESS: "",
  AGENT_ID_ADDRESS: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  BSC_RPC: "https://bsc-dataseed.binance.org",
  CHAIN_ID: 56
};
