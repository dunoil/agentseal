# AgentSeal — Contracts

**Hire an agent by its `.ai` name. The payment stays sealed in escrow until the work checks out — and every settled job builds the reputation nobody can fake. _Receipts, not ratings._**

Built for the **Binance Agent ID Hackathon** (Binance Wallet × BNB Chain). One Solidity contract, zero external dependencies, BNB Smart Chain.

- `contracts/AgentSeal.sol` — the product contract.
- `contracts/MockAgentID.sol` — **test-only** stand-in for the Agent ID gate. Never deploy it to a live network.
- `test/AgentSeal.t.sol` — 28-test Foundry suite (hand-declared cheatcodes, no forge-std dependency).
- `scripts/compile.js` — solc-js compile → `artifacts/*.json` (ABI + bytecode for the deploy script / verification).
- `scripts/check-abi.js` — red-line guard: fails if the compiled ABI ever grows a withdrawal/sweep/rescue/arbitrary-call function or a receive/fallback.
- `scripts/deploy.js` — ethers deploy script (testnet first; mainnet is guarded, see below).

## How it works

Only wallets holding a **SPACE ID Agent ID** (`.ai` name, ERC-721, soulbound) can take part. The gate is enforced **in the contract**: `registerProfile`, `vouch`, `createJob` and `acceptJob` all run through an `onlyHolder` modifier that calls `balanceOf(msg.sender) > 0` on the official Agent ID contract.

1. **Register** — a holder creates a provider profile (`category` + `metadataURI`) and receives a sequential *founding number*.
2. **Vouch** — holders vouch for registered providers (one per holder per provider, no self-vouching).
3. **Hire** — a client posts a job to a registered provider, escrowing BNB in the contract (`createJob`, payable, with a delivery deadline).
4. **Work** — the provider `acceptJob`s and later `deliverJob`s, anchoring a `bytes32` hash of the deliverable on-chain.
5. **Settle** — the client `releaseJob`s and the escrow pays the provider in full. If the client goes silent, the provider can `claimAfterWindow` **3 days** after delivery. If the provider never delivers, the client can `cancelJob` for a **full refund** (any time before acceptance, or after the deadline if undelivered).
6. **Rate** — only the paying client, only after settlement, exactly once per job (1–5). Ratings without a paid, settled job are impossible by construction — reputation (`getProviderStats`: settled jobs, settled volume, rating sum/count, vouches) derives only from escrow events.

The contract also counts **unique interactors** (addresses that ever passed the holder gate and acted) in `uniqueInteractorCount` — the metric behind the hackathon's 30-Agent-ID eligibility threshold.

Job states: `Open → Accepted → Delivered → Released | ClaimedAfterWindow`, or `→ Refunded` via cancellation.

## Owner powers — full disclosure

The owner (deployer) can **only**:

1. `setRegistrationsPaused(bool)` — pause/unpause **new** profile registrations.
2. `setJobCreationPaused(bool)` — pause/unpause **new** job creation.

That is all. In particular:

- There is **no withdrawal, sweep, rescue, upgrade, mint, ownership-transfer or arbitrary-call function** — enforced by `scripts/check-abi.js` against the compiled ABI.
- The contract has **no `receive`/`fallback`**: plain BNB transfers revert. BNB can only enter via `createJob` and can only leave to the job's provider (release / window claim) or back to the job's client (cancellation refund).
- Pausing never blocks delivery, release, claims or refunds on existing jobs.
- There is **no platform fee** and **no token**. Nothing in this project promises any return to anyone.

## Security notes

- Solidity `^0.8.20` (compiled with 0.8.26), optimizer 200 runs. Runtime size **10,807 bytes** (BSC limit 24,576).
- Checks-effects-interactions on every payout path, plus a hand-rolled reentrancy guard on `releaseJob`, `claimAfterWindow` and `cancelJob` (hand-rolled so the project stays zero-dependency and single-file verifiable on BscScan).
- Forge lint notes, reviewed and accepted: `block-timestamp` comparisons are used only for deadlines/windows measured in hours–days (validator manipulation is seconds-scale); the `reentrancy-eth`/`reentrancy-events` notes on the settle path are mitigated by the guard + state being finalised (state set, amount zeroed, stats updated) before the external call.

## Toolchain

Nothing is installed system-wide. Everything lives in this folder:

| Tool | How it gets here |
|---|---|
| Foundry (forge/anvil/cast) v1.9.0 | Downloaded once into `tools/` from the official GitHub release (sha256 verified). Re-fetch: `curl -L https://github.com/foundry-rs/foundry/releases/download/v1.9.0/foundry_v1.9.0_linux_amd64.tar.gz` and extract into `tools/`. |
| solc-js 0.8.26, ethers v6 | `npm install` (local `node_modules/`) |

> Environment note: the Ganache build available here mis-executes `eth_call` for string-returning functions (reproduced with a 10-line minimal contract), and ethers-v6 gas estimation against this Anvil build intermittently reads one-block-stale state after a reverted estimate. The Foundry suite runs in-process and is deterministic, so it is the authoritative test path.

## Compile

```bash
npm run compile        # solc-js -> artifacts/
./tools/forge build    # independent second compile via forge (solc 0.8.26)
```

## Test

```bash
npm test               # ./tools/forge test  (28 tests)
npm run check-abi      # red-line ABI guard (run compile first)
```

Expected: `28 passed; 0 failed`.

## Deploy

**Testnet first (chainId 97).** There is no official Agent ID contract on BSC testnet, so for a rehearsal deploy `MockAgentID` yourself and pass its address — a testnet deployment proves mechanics only; the real gate only exists on mainnet.

```bash
cp .env.example .env   # fill in RPC_URL + PRIVATE_KEY (+ AGENT_ID_ADDRESS on testnet)
node scripts/compile.js
node scripts/deploy.js
```

**Mainnet (chainId 56).** The deploy script refuses mainnet unless `CONFIRM_MAINNET=YES` is set, and on mainnet it refuses any Agent ID address other than the official one:

- **Agent ID (constructor argument): `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`** (SPACE ID Agent ID, BNB Smart Chain mainnet — the default when `AGENT_ID_ADDRESS` is unset).

After deploying, verify the source on BscScan (single file, solc 0.8.26, optimizer on, 200 runs) and run `npm run check-abi` against the final artifact.

## Repository layout

```
contracts/   AgentSeal.sol, MockAgentID.sol
test/        AgentSeal.t.sol
scripts/     compile.js, check-abi.js, deploy.js
foundry.toml package.json .env.example
```
