# AgentSeal — Build-Out Progress

**Date:** 19 Nov 2026 · **Status:** contract ✅ · name resolution ✅ · frontend ✅ · repo ✅ (below) · testnet rehearsal ⛔ blocked on faucet · mainnet ⏸ not started (by design)

---

## 1. Name resolution — VERIFIED ON-CHAIN (details: `NAME-RESOLUTION.md`)

Read-only investigation against the live SPACE ID Agent ID contract
`0x60b9262456de011f7d15a54cdd8c48baaa8b022f` (BSC mainnet), using real holders
found from Transfer/mint logs (42 mints in blocks 134397401–134401401 alone).
All values in `NAME-RESOLUTION.md` are verbatim chain/RPC responses.

**Findings that matter:**

- `balanceOf(holder) = 1` for all sampled holders — the holder gate works as documented.
- The contract is **not** ERC-721 Enumerable: `supportsInterface(0x780e9d63) = false`,
  `tokenOfOwnerByIndex` and `totalSupply` **revert**. There is **no** single-call
  address → tokenId lookup.
- **`tokenId = uint256(keccak256(utf8(label)))`** — verified exactly for 3 real
  names (`walia1`, `sherif01`, `tandama`).
- `tokenURI(tokenId)` returns `https://agentid.prd.space.id/metadata/<label>.json`;
  the label is readable from the on-chain URL itself, and the JSON's `name` field
  cross-checks (bare label, no `.ai` suffix; display as `<label>.ai`).
  Metadata host is GET-only (HEAD returns 404).
- **Forward resolution is fully trustless:** label → `keccak256` → `ownerOf(tokenId)`
  = holder address, `tokenURI` confirms the label. No indexer needed.
- Address → name is possible only via mint-log indexing (chunked; public RPCs cap
  `eth_getLogs` hard — dataseed refuses, Pocket ≈5,000-block chunks).

**Verdict for AgentSeal:** at registration the owner self-declares their `.ai`
label, and the frontend **cryptographically verifies** it with one `eth_call`:
`ownerOf(keccak256(label)) == registering address` (+ `balanceOf > 0`). A fake
label cannot pass. The mint-log indexer is an optional convenience, never a
correctness dependency. The frontend's Check tool (built before this verdict
landed) already degrades gracefully; wiring the `ownerOf(keccak256(label))`
check into the registration card is a small post-launch-config edit, noted in §6.

## 2. Frontend — BUILT & VERIFIED (`frontend/`)

Plain HTML/CSS/JS, no build step, GitHub Pages-ready. Files: `index.html`,
`style.css`, `app.js`, `config.js`, `abi.js` (generated from the compiled
contract artifact), `vendor/ethers.umd.min.js` (vendored from the project's
own ethers install — no CDN dependency).

- **Counter** reads `uniqueInteractorCount()` via public BSC RPC when
  `config.js` `CONTRACT_ADDRESS` is set; while empty it shows `— / 30` +
  “Contract deploying soon” — **never a fake number**.
- **Providers / Jobs** enumerate from the contract (ProfileRegistered logs /
  `jobCount` + `getJob`) when configured; honest empty states otherwise.
- **9 action cards** (register, vouch, createJob, accept, deliver, release,
  claimAfterWindow, cancel, rate): form → human-readable summary (function,
  args, value in wei **and** BNB, exact ABI-encoded calldata) + copy-paste
  **agent prompt** in the required baw style — check `baw wallet agent-id --json`
  and Developer Mode via `baw wallet settings --json` first, `baw contract-call
  preview` with exact `--to/--value/--inputData`, execute only after the user's
  explicit confirmation. Copy buttons included. While undeployed, `--to` is an
  explicit `PENDING_DEPLOYMENT` placeholder with a do-not-execute note.
- **“Check my Agent ID” works today** against the live Agent ID contract
  (balanceOf; zero-address edge case handled — the real contract reverts on it).
- Developer Mode 3-step guide + safety copy (no seed phrases/keys/pairing
  codes ever, no QR login, escrow rules, owner cannot withdraw, no returns promised).
- Branding is AgentSeal only — no Binance/BNB logos or impersonation.

**Verification (actually run):** `node --check` OK on app.js / config.js /
abi.js; calldata round-trip test in Node for all 9 functions (encode → decode
identical, selectors match the compiled contract); every file referenced by
index.html exists; local `python3 -m http.server` + curl returned HTTP 200 for
`/`, index.html, style.css, config.js, abi.js, app.js and the vendored ethers;
live mainnet RPC spot-checks of the Check tool's balanceOf path. No headless
browser exists on this VM, so no screenshot verification — recorded honestly.

## 3. GitHub repo

- **URL:** https://github.com/dunoil/agentseal (public)
- Contents: `contracts-project/` (per its `.gitignore` — no node_modules, no
  Foundry binaries, no `.env`, no forge-out/cache/artifacts), `frontend/`,
  `CONCEPT.md`, `BUILD-REPORT.md`, `NAME-RESOLUTION.md`, `PROGRESS.md`,
  root `README.md`.
- **Key-safety check before push:** `git check-ignore` confirms
  `contracts-project/.env` (which holds the deployer key) is ignored; the
  staged tree was inspected and contains no `.env`, no `node_modules`,
  no `tools/` binaries.
- Push verification: see the verification addendum at the bottom of this file
  (appended after the push, in a follow-up commit — this file cannot contain
  its own push receipt before it exists).

## 4. Deployer wallet & mainnet gas estimate

- **Deployer (public address): `0x92Ce3ED9E99aaB964609Bbf412A6530a6c683702`**
- Private key exists **only** in `contracts-project/.env` (file mode 600,
  gitignored, verified not staged). It is not printed in any report.
- Mainnet balance at preparation time: 0 BNB (checked via eth_getBalance).
- **Gas math (ESTIMATE):** AgentSeal deployment measured on a local Anvil
  chain at **2,412,362 gas** (MockAgentID: 131,763 gas, testnet/local only).
  BSC mainnet `eth_gasPrice` sampled 19 Nov 2026 from bsc-dataseed:
  `0x2faf080` ≈ **0.05 gwei** → deploy cost ≈ 2,412,362 × 0.05 gwei
  ≈ **0.00012 BNB**. Even at 1 gwei (20× the sampled price) it is ≈ 0.0024 BNB.
- **Recommended funding: send `0.01 BNB` to the deployer address.** That covers
  the deploy with ~40–80× headroom at recent prices, plus BscScan verification
  steps and several follow-up transactions. Labelled estimate — re-check
  `eth_gasPrice` on deploy day.

## 5. Testnet rehearsal — BLOCKED ON FAUCET (documented, not faked)

- Deployer testnet balance: **0 tBNB** (checked on 5 testnet RPC endpoints).
- Official BNB Chain testnet faucet (bnbchain.org/en/testnet-faucet): the page
  requires a **captcha** (and account sign-in) — cannot be completed
  autonomously without Duan.
- A direct POST to a guessed faucet API endpoint returned an empty response
  and no funds; QuickNode's BSC testnet faucet requires an account.
- Balance re-checked after all attempts: still `0x0`.
- **Decision (per plan): stop here.** Deploy-script correctness is already
  proven end-to-end on a local Anvil chain (see `BUILD-REPORT.md`: MockAgentID
  + AgentSeal deployed via the same `scripts/deploy.js`, getters verified with
  cast). The testnet rehearsal remains a pre-mainnet checklist item for
  whenever a faucet drip or a small tBNB source is available — it is a
  rehearsal nicety, not a correctness gap.
- **No mainnet deployment was made and no real funds were touched.**

## 6. Precise remaining steps to launch

1. **(Optional, 10 min)** Wire the `ownerOf(keccak256(label))` verification
   into the frontend registration card + Check tool (verdict in §1).
2. **Fund the deployer:** send **0.01 BNB** (BSC mainnet) to
   `0x92Ce3ED9E99aaB964609Bbf412A6530a6c683702`. ← the only step needing Duan's wallet
3. **(Optional)** Testnet rehearsal if tBNB becomes available: deploy
   MockAgentID on BSC testnet → `scripts/deploy.js` with `AGENT_ID_ADDRESS`
   = mock → smoke-test register/vouch on testnet.bscscan.com.
4. **Mainnet deploy:** set `RPC_URL=https://bsc-dataseed.binance.org` and
   `CONFIRM_MAINNET=YES` in `contracts-project/.env`, run
   `node scripts/deploy.js` (it refuses mainnet without the flag and refuses
   any Agent ID address other than the official one). Record the address.
5. **Verify on BscScan:** single-file source, solc 0.8.26, optimizer 200 runs;
   re-run `npm run check-abi` on the final artifact; confirm the deployed
   `agentID()` returns `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`.
6. **Go live:** paste the deployed address into `frontend/config.js`
   (`CONTRACT_ADDRESS`), commit + push, enable **GitHub Pages** for
   `dunoil/agentseal` (serve from `frontend/` — or move the site to `docs/`
   if Pages source options require it; the site is path-agnostic).
7. **Interaction campaign** (per CONCEPT.md §5): Founding Agents drive,
   vouch loop, 2–3 seeded real jobs, X + Binance Square posts with the agent
   prompt embedded; public counter target **30+ unique Agent ID interactors**,
   stretch 75–150.
8. **Submit on 8 Dec 2026** (deadline 9 Dec 08:00 UTC): project name, website
   (GitHub Pages URL), contract address, Agent ID usage description.
   Separately post the community X post with #BinanceWalletHackathon +
   #AgenticWallet and file the survey for the $100 community prize.

---

## Addendum — repo push verification

Verified 19 Nov 2026 after the initial push:

- `gh repo view dunoil/agentseal` → `url=https://github.com/dunoil/agentseal`,
  `visibility=PUBLIC`, default branch `main`.
- `git ls-remote origin` → `04eb66190c1f25ad837eb9336a7e958adb5da356` for both
  `HEAD` and `refs/heads/main` (the initial commit).
- Fresh clone to a clean directory: `git ls-files` output **identical** to the
  local repo — **24 files**, trees match exactly.
- The clone contains **no `.env` file** (find confirms) and no `node_modules`
  or Foundry `tools/` binaries — the deployer key never left this machine.
- This addendum itself is delivered in the follow-up commit immediately after
  the initial push, so the live repo's PROGRESS.md is the complete version.
