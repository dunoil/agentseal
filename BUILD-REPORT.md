# AgentSeal — Contract Build Report
Date: 19 Nov 2026 | Status: **built + fully tested locally; NOT deployed to any live network**

## What was built

A single zero-dependency Solidity contract implementing the CONCEPT.md spec end-to-end, plus a mock gate for tests, a 28-test Foundry suite, compile/ABI-guard/deploy scripts, and full documentation.

## Files created (all under `contracts-project/` unless noted)

| File | Purpose |
|---|---|
| [contracts/AgentSeal.sol](sandbox://workspace/agent-id-hackathon/contracts-project/contracts/AgentSeal.sol) | The product contract (~430 lines, NatSpec incl. owner-power disclosure) |
| [contracts/MockAgentID.sol](sandbox://workspace/agent-id-hackathon/contracts-project/contracts/MockAgentID.sol) | Test-only ERC-721 stand-in (`balanceOf`/`mint`) for the Agent ID gate |
| [test/AgentSeal.t.sol](sandbox://workspace/agent-id-hackathon/contracts-project/test/AgentSeal.t.sol) | 28-test Foundry suite, hand-declared cheatcodes (no forge-std) |
| [scripts/compile.js](sandbox://workspace/agent-id-hackathon/contracts-project/scripts/compile.js) | solc-js compile → `artifacts/*.json` |
| [scripts/check-abi.js](sandbox://workspace/agent-id-hackathon/contracts-project/scripts/check-abi.js) | Red-line guard over the compiled ABI |
| [scripts/deploy.js](sandbox://workspace/agent-id-hackathon/contracts-project/scripts/deploy.js) | Ethers deploy script; mainnet requires `CONFIRM_MAINNET=YES` + the official Agent ID address |
| [README.md](sandbox://workspace/agent-id-hackathon/contracts-project/README.md) | Compile / test / deploy (testnet + mainnet), owner powers, security notes |
| `foundry.toml`, `package.json`, `.env.example`, `.gitignore` | Project config |

## Contract summary

- **Gate:** `onlyHolder` modifier calls `balanceOf > 0` on the Agent ID ERC-721 (constructor arg; mainnet default `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) — enforced on `registerProfile`, `updateProfile`, `vouch`, `createJob`, `acceptJob`.
- **Flows:** register (+ sequential founding number, update) → vouch (no self/duplicate) → `createJob` escrows BNB → `acceptJob` → `deliverJob(bytes32)` → `releaseJob` (client pays provider in full, receipt recorded) **or** `claimAfterWindow` (provider, 3 days post-delivery) → `rateJob` (paying client only, post-settlement, once). `cancelJob` refunds in full before acceptance or after an undelivered deadline.
- **Read helpers:** `getProfile`, `getProviderStats` (settled jobs / volume / rating sum+count / vouches), `getJob`, `jobCount`, `uniqueInteractorCount` + `hasInteracted` (the 30-address eligibility metric, counted once per gated address).
- **Red lines honoured:** NO owner withdrawal/sweep/rescue/upgrade/arbitrary-call function exists (verified against the compiled ABI by `check-abi.js`: 26-function surface, clean); no `receive`/`fallback` (plain transfers revert); owner can only pause NEW registrations / NEW job creation, and pausing never blocks settlement of existing jobs; checks-effects-interactions + hand-rolled reentrancy guard on all payout paths; no token, no fee, no returns promised anywhere.

## Toolchain (nothing installed system-wide)

- **Foundry v1.9.0** (forge/anvil/cast) downloaded into `contracts-project/tools/` from the official GitHub release, sha256 verified against the release checksum (`8d17599b…a51ae99`).
- **solc 0.8.26** twice over: forge's native solc + solc-js via local npm (`solc@0.8.26`, `ethers@6`) — both compile the contract cleanly and agree on size.
- Node v24.22.1 / npm 10.9.4 (pre-existing on the machine).

## Test results — real output

```
./tools/forge test
Ran 28 tests for test/AgentSeal.t.sol:AgentSealTest
Suite result: ok. 28 passed; 0 failed; 0 skipped
```

Coverage: non-holder rejected on register/vouch/create/accept · founding numbers 1,2 sequential · duplicate registration rejected · updateProfile · vouch count, duplicate + self + unregistered vouch rejected · happy path create→accept→deliver→release→rate with **exact wei-level balances** (provider +0.5 BNB, contract → 0) and stats · third-party accept/deliver rejected · release-before-delivery rejected · rating rules (before settlement / non-client / out-of-range / double) · cancel-before-acceptance full refund · cancel-after-deadline full refund (and blocked before it) · delivered job uncancellable · claim-after-window (blocked at <3 days, exact payout at 3 days+1s, counts as settled, rating still possible) · pause behaviour (non-owner can't; paused registrations/jobs rejected; settlement of existing jobs never blocked) · owner cannot move escrow (party-check reverts, balance untouched) · plain BNB transfer reverts · unique interactors counted exactly once across action types · createJob input validation · jobCount / bad-id revert.

Also verified:
- `npm run check-abi` → **OK** (no banned functions, no receive/fallback; runtime **10,807 bytes** of the 24,576 BSC limit).
- **Deploy script proven end-to-end on a local Anvil chain** (chainId 31337, throwaway dev keys, no real funds): MockAgentID at `0x5FbDB2315678afecb367f032d93F642f64180aa3`, AgentSeal deployed via `scripts/deploy.js` at `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`; `cast` confirmed `owner()`, `agentID()` and `CLAIM_WINDOW() = 259200` (3 days). Local instance discarded with the chain.

## Compile warnings

- **solc: none** (both compilers, clean runs).
- **Forge lint notes only** (not compiler warnings), reviewed and accepted — rationale documented in the README: 3× `block-timestamp` (deadlines/windows are hours–days scale), 1× `reentrancy-eth` + 1× `reentrancy-events` on the settle path (mitigated by the reentrancy guard and by state being finalised — state set, amount zeroed, stats updated — before the external call).

## Toolchain incident worth knowing about

The first test harness (ethers v6 + Ganache) produced 26 spurious failures. Root-caused with minimal repros: **this environment's Ganache build returns `CallError` with empty data for ANY `eth_call` to a string-returning function** (even a pure `return "hello"`), and ethers-v6 gas estimation against this Anvil build intermittently reads one-block-stale state after a reverted estimate. The contract was never at fault — the same bytecode passes 28/28 under Foundry's in-process EVM. The Node/Ganache runner was deleted; `forge test` is the authoritative suite (reason documented in the README).

## What remains before mainnet deploy

1. **A funded deployer wallet** on BSC mainnet (deploy gas only — expected well under $5; ~0.01 BNB float per CONCEPT.md) — deployer key must come from Duan via a secure channel; it is NOT in the repo (`.env` is gitignored, only `.env.example` is committed).
2. **Duan's explicit go-ahead** for the mainnet deploy (per the 28 Nov–1 Dec timeline slot in CONCEPT.md), after a BSC **testnet rehearsal** deploy (deploy MockAgentID on testnet → deploy AgentSeal against it → smoke-test the flows on testnet.bscscan.com).
3. After mainnet deploy: BscScan source verification (single file, solc 0.8.26, optimizer 200 runs), re-run `check-abi` on the final artifact, and record the deployed address for the frontend build.
4. Still open from CONCEPT.md §8: verify `.ai` name-resolution behaviour on-chain using Duan's claimed Agent ID (needs his `.ai` name / Agentic Wallet BSC address, not yet shared) — this affects the frontend only, not this contract, which works purely on addresses by design.
