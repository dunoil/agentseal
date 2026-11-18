# Agent ID Hackathon — Concept & MVP Spec
Binance Wallet x BNB Chain | Submission: 18 Nov – 9 Dec 2026 08:00 UTC (16:00 WITA)
Total prize pool: 60,000 USDC (58,000 project awards + 2,000 community X promotion)
Prepared: 18 Nov 2026 for Duan (@dunoil)

## 1. What the judges actually score (verified from the official announcement + dev docs)

Innovation Award (100 pts):
- Agent ID Application Depth — 30%
- Practicality & Feasibility — 25%
- Product Completion — 25%
- Innovation — 20%

Eligibility gate for Innovation Award: product live + **at least 30 Agent ID addresses interacted** with the contract during the submission period.
Second track (same prize table, one award per project max): on-chain ranking by unique interacting Agent ID addresses + transaction volume/count.
Top 10 in each track: $10,000 / $6,000 / $4,000 / $3,000 / $2,000 / $800 x5.

## 2. Technical reality that shapes the whole design (verified)

- Agent ID = SPACE ID ERC-721 on BNB Chain, contract `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`, soulbound, one per Agentic Wallet, format `name.ai`, 3–15 chars. Holder check = `balanceOf(address) > 0` — the only integration the announcement itself documents.
- 182,040 Agent IDs had already been claimed by 11 Nov 2026 (BAS index) — the pool of potential interactors is large; 30 is achievable with real outreach.
- **Agentic Wallet cannot do normal dApp flows.** By default it only performs verified operations (swap, transfer, limit orders, prediction, DeFi). It cannot `personal_sign` — so "Sign in with Ethereum", plain-message claim pages and allowlist signatures are impossible with it, and keys are MPC-keyless / non-exportable.
- **Developer Mode is the one exception:** enabled only inside the Binance App (time-boxed, own daily spend cap), it allows user-constructed contract calls via the official CLI: `baw contract-call preview` -> user sees simulation + risks -> explicit confirmation -> `baw contract-call execute --requestId ...`. Message signing stays EIP-712-only.
- Therefore every successful early project (Flaggies, Horror Protocol, UNITS) uses the same pattern: **website never asks for a signature; each action hands the user a ready-to-paste agent prompt + exact contract/function/args, executed through their own agent in Developer Mode.** Our dApp must follow this pattern, not a MetaMask-style connect flow.
- Name resolution (.ai name <-> address / tokenId / tokenURI) is NOT documented in the hackathon resources. Working assumption to verify on-chain once we hold an Agent ID: ERC-721 enumerable (`tokenOfOwnerByIndex`) + `tokenURI` metadata from the SPACE ID registrar pattern. Design must degrade gracefully: profile works with address alone; the .ai label is attached when resolution succeeds or when the owner registers it themselves.
- Safety red lines (disqualification): no web QR/pairing-code login for Agentic Wallet, no bypassing user transaction confirmation in any skill/prompt, no unauthorised/scheduled/bundled transfers, no unlimited approvals without user knowledge, contracts open-source with owner powers disclosed, no Binance/BNB brand impersonation in project/token/domain names, no collecting seed phrases/private keys/API secrets/pairing codes, no promising returns ("passive income" etc.), trading products must show risk warnings, Agent ID must not be packaged as a tool for looking up other people's wallets by name.

## 3. Concepts scored

Scoring vs the 100-pt rubric + interaction-loop strength (drives the 30-address gate and the on-chain track).

| Concept | Depth 30 | Practical 25 | Complete 25 | Innov 20 | Loop | Total feel |
|---|---|---|---|---|---|---|
| **A. AgentSeal — escrow + paid-job reputation for hiring agents** | High: identity gate + hiring by .ai + payment escrow + receipts all core | High: agent economy has no trust layer; paid jobs already happen ad-hoc (e.g. agents paid in stablecoins via .ai names) | Medium: one contract + static site, doable solo | High: "receipts, not ratings" — reputation only from settled paid jobs | Strong: register, vouch, post job, accept, deliver, release, rate = 7 tx types | **WINNER** |
| B. AgentGate — gated mint/content toolkit | Medium | Medium | Easy | Low: Flaggies, Horror Protocol, UNITS, Four.Meme gated mode already saturate this exact pattern | One mint and done | Rejected: crowded |
| C. PayName — invoice/payment links by .ai name | Medium | Medium: native Binance transfer already does name.ai payments | Easy | Low | Weak repeat use | Rejected: competes with a native feature |
| D. AgentBoard — public activity index for .ai names | Low | Medium | Easy | Low: agent.bas.io already indexes Agent IDs vs ERC-8004/8183 | None (read-only = zero contract interactions, fails the gate) | Rejected: also brushes the "lookup other people's wallets" red line |

## 4. THE CONCEPT — AgentSeal

**One line:** Hire an agent by its `.ai` name. The payment stays sealed in escrow until the work checks out — and every settled job mints the reputation nobody can fake.

**Tagline for submission:** *Receipts, not ratings.*

### Why this wins on depth (30%)
Agent ID is not a login badge bolted on the side; it is the product's spine:
1. **Identity gate** — only Agent ID holders can register a provider profile, post a job, or vouch (`balanceOf` checked on-chain in the contract, not in the frontend).
2. **Hiring identity** — providers are hired by their Agent ID; the profile is bound to the soulbound token's owner address, so a reputation cannot be sold or transferred away from the identity that earned it.
3. **Payment identity** — escrow releases only to the registered provider address behind that `.ai` name.
4. **Reputation identity** — job receipts accumulate per Agent ID holder, portable and verifiable by any other dApp reading the contract.

### Core flows (all contract interactions count toward the 30-address gate)
1. `registerProfile(category, metadataURI)` — free except gas. Metadata JSON (display name, skills, description, rate, contact/endpoint) hosted on GitHub/IPFS; URI stored on-chain.
2. `vouch(provider)` — one vouch per holder per provider. The low-friction first interaction we ask every visitor to make.
3. `createJob(provider, descriptionURI)` payable — client deposits BNB (small amounts; explicit amount shown, user confirms in their own wallet flow — no auto-sign tricks).
4. `acceptJob(jobId)` / `deliverJob(jobId, deliverableHash)` — provider accepts, then anchors a hash of the deliverable.
5. `releaseJob(jobId)` — client releases escrow; mints a non-transferable **Job Receipt** record and updates provider stats. If the client goes silent, provider can claim after a 3-day review window post-delivery (`claimAfterWindow`). If the provider never delivers by the deadline, client can `cancelJob` for a full refund.
6. `rateJob(jobId, 1-5)` — only the paying client, only after release. Ratings without a paid, settled job are impossible by construction.

### Anti-fake design (the innovation story, 20%)
- Reputation score = settled jobs + total released volume + rating, all derived from escrow events. A free self-review farm produces nothing.
- Profiles are **opt-in only** — nobody's wallet is exposed because they hold an Agent ID. Search finds registered providers, never arbitrary holders. This keeps us clearly clear of the wallet-lookup red line.
- Contract has **no owner withdrawal function at all**. Owner powers (documented in repo + submission): pause *new* registrations/jobs only; escrowed funds can only ever go to the job's provider or back to its client.

### Frontend (static, GitHub Pages — $0 hosting)
- Browse providers, job board, provider profile pages, leaderboard (most receipts / most vouched). Read-only via public BSC RPC — **no wallet connection needed to browse** (Agentic Wallets can't SIWE anyway).
- Every action card shows: what will happen, exact contract address, function + human-readable args, value in wei and BNB — plus a **copy-paste agent prompt** for the Binance Agentic Wallet flow, e.g.:
  "Use the binance-agentic-wallet skill (baw) on BNB Smart Chain (binanceChainId 56) to call AgentSeal at 0x…: preview `registerProfile` with category 'research' and metadata URI '…', show me the preview and risks, and execute only after I confirm. First check `baw wallet agent-id --json` — if I hold no Agent ID, stop and tell me to claim one in the Binance App. Also check Developer Mode via `baw wallet settings --json`."
- "Check my Agent ID" tool: paste an address -> `balanceOf` result + registration status.
- Risk wording on all payment actions; no return promises anywhere in copy.

### Contract sketch — `AgentSeal.sol` (single contract, BSC mainnet, verified on BscScan)
- Interface: `IAgentID { balanceOf(address) }` at the official address; `onlyHolder` modifier.
- State: `profiles[address]`, `vouches[provider][voucher]`, `jobs[]` (client, provider, amount, deadline, state, deliverableHash, rating), `receipts[provider] count`, events for every transition (indexer-free frontend reads via events + getters).
- Solidity + Foundry/Hardhat tests; deploy script; BscScan verification; GitHub public repo from day one.

## 5. Getting to 30+ interacting Agent ID addresses (the real campaign)
Pool: 182k+ claimed IDs. Channels, in order:
1. **Founding Agents drive** — first 100 registered providers get an on-chain "Founding" sequence number on their profile. Registration is gas-only.
2. **Vouch loop** — every registrant is prompted to vouch for 2 providers they know; vouching is the cheapest possible first tx for a visitor who isn't ready to register.
3. **Seeded real jobs** — Duan posts 2–3 small genuine jobs (e.g. research summary, logo draft, data scrape) with tiny escrow from our own budget; providers completing them become the first receipts and the demo story. Escrow returns/fees: the seed money pays real providers for real work, it is not burned.
4. **X + Binance Square posts** from @dunoil (1,831 followers) with the agent prompt embedded — agent-native distribution: an Agent ID holder's own AI agent can execute the registration prompt directly. Also post in SPACE ID / BNB Chain / Agentic Wallet community threads where holders already gather (Four.Meme agent traders, Flaggies holders).
5. **Live counter** on the homepage: "N / 30 Agent ID holders have interacted" — turns the eligibility gate into the public game.
Target: 30 by end of week 2, 75–150 by 9 Dec for the on-chain track.

## 6. Cost (verified structure; amounts estimated where gas-dependent)
- Entry: $0. Agent ID claim: name free, small BNB gas only.
- Deploy + verify: gas only, expected < $5 total on BSC.
- Hosting/domain: $0 (GitHub Pages + public repo).
- Working float: ~0.01 BNB covers claim + deploy + our test interactions; optional small seed-job budget on top (pays real providers, not a fee).
- No token purchase, no entry deposit, no paid tools required.

## 7. Timeline (solo, fits after Hyper Elements 29 Nov / BuildHybridAI 30 Nov peaks — contract work can start in parallel gaps)
- **19–22 Nov:** Duan claims Agent ID in Binance App (only step only he can do); verify name-resolution assumptions on-chain with his token; finalise contract.
- **23–27 Nov:** Contract tests, testnet deploy (BSC testnet), frontend build.
- **28 Nov–1 Dec:** Mainnet deploy + BscScan verification, repo public, soft launch + Founding drive starts.
- **2–7 Dec:** Seeded jobs, vouch loop, X/Square campaign, counter push past 30 -> aim 75+.
- **8 Dec:** Submission package submitted (project name, website, contract addresses, Agent ID usage description) — one full day before the 9 Dec 08:00 UTC deadline.
- Also: one X post about a participating project with #BinanceWalletHackathon + #AgenticWallet + survey submission for the separate $100 community prize.

## 8. Risks / open items
- Name resolution API unverified — mitigations in §2; test with Duan's own Agent ID first.
- Developer Mode friction (users must enable it in-app; it expires) — mitigate with a pictorial 3-step guide and by making the first interaction (vouch/register) a single call.
- Binance may read "mainnet only" strictly — we deploy on BSC mainnet from the start; testnet is rehearsal only.
- Region note: announcement says products may not be available in all regions; Duan participates as an Indonesia-based developer submitting a project (no Binance account action is part of the submission itself beyond claiming the ID he is eligible to claim in-app).
