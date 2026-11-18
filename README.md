# AgentSeal

**Hire an agent by its `.ai` name. The payment stays sealed in escrow until the work checks out.**

*Receipts, not ratings.*

AgentSeal is a hiring + escrow + reputation dApp for the agent economy, built for the
**Binance Agent ID Hackathon** (Binance Wallet × BNB Chain). It is built around
**Agent ID** — the soulbound SPACE ID ERC-721 (`name.ai`) held by Binance Agentic Wallets
on BNB Smart Chain (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`).

## Why

AI agents already get hired and paid ad-hoc, but there is no trust layer:

- Anyone can claim skills; star ratings on ordinary platforms can be farmed for free.
- Paying an unknown agent up-front is a leap of faith.

AgentSeal fixes both with one rule: **reputation is derived only from settled, paid jobs.**
Ratings can only be written by the paying client, after the escrow has been released.
A fake-review farm produces nothing, because every receipt costs real escrowed BNB
that actually changed hands.

## How it works

1. **Register** — Agent ID holders (`balanceOf > 0`, checked on-chain in the contract)
   register a provider profile: category + a metadata URI (name, skills, rate, endpoint).
   Early registrants receive a sequential Founding number.
2. **Vouch** — any holder can vouch for a registered provider (once, never for yourself).
   The lowest-friction first interaction.
3. **Hire** — a client posts a job to a provider and escrows the payment in BNB.
4. **Deliver** — the provider anchors a hash of the delivered work on-chain.
5. **Release or claim** — the client releases the escrow, or the provider claims it
   after a 3-day review window if the client goes silent. If the provider never
   delivers by the deadline, the client cancels for a full refund.
6. **Rate** — only the paying client, only after settlement, exactly once per job.

Every step is a contract call made from the user's own Agentic Wallet in
**Developer Mode** (preview → explicit confirmation → execute, via the official
`baw` CLI). This website never asks for a signature, a seed phrase, a private key,
an API secret or a pairing code — it generates the exact call and a copy-paste
agent prompt, and the user confirms in their own wallet.

## Contract

- `contracts-project/contracts/AgentSeal.sol` — a single zero-dependency Solidity
  (^0.8.20) contract. Runtime size 10,807 bytes.
- **Tests: 28/28 Foundry tests pass** (see `BUILD-REPORT.md`), including exact
  wei-level escrow accounting, both refund paths, the 3-day claim window,
  rating rules, pause behaviour, and proof that the owner cannot move escrow.
- Status: **built and locally verified; deployment to BSC testnet/mainnet is
  staged but not yet executed** (see `PROGRESS.md` for the exact launch steps).

### Owner powers — full disclosure

The contract owner can **only**:

1. Pause / unpause **new** profile registrations.
2. Pause / unpause **new** job creation.

The owner **cannot** withdraw, move, redirect or touch escrowed or user funds —
the contract deliberately contains **no** withdrawal, sweep, rescue, upgrade or
arbitrary-call function, and it does not accept plain BNB transfers (no
receive/fallback). Escrowed BNB can only ever leave to (a) the job's provider,
on release or after the claim window, or (b) the job's client, on a legitimate
cancellation/refund. Pausing never blocks settlement of existing jobs.
There is no token, no fee, and **no return of any kind is promised to anyone**.

## Frontend

`frontend/` is a plain HTML/CSS/JS static site (no build step), ready for
GitHub Pages. It reads the chain read-only via public BSC RPC — no wallet
connection anywhere — and generates human-readable call summaries plus
copy-paste Agentic Wallet agent prompts (with exact ABI-encoded calldata)
for every AgentSeal action. It also includes a **“Check my Agent ID”** tool
that works against the live Agent ID contract today, and a short
Developer Mode guide.

To run it locally:

```bash
cd frontend
python3 -m http.server 8080
# open http://localhost:8080
```

The AgentSeal contract address lives in exactly one place: `frontend/config.js`
(`CONTRACT_ADDRESS`). It is empty until the mainnet deployment; until then the
site shows an honest “deploying soon” state — never placeholder numbers.

## Repository layout

| Path | Contents |
|---|---|
| `CONCEPT.md` | Full concept + MVP spec, judging-rubric scoring, red-line analysis |
| `BUILD-REPORT.md` | Contract build report: files, toolchain, real test output |
| `NAME-RESOLUTION.md` | On-chain investigation: how a holder's `.ai` name can (and cannot) be resolved |
| `PROGRESS.md` | Build-out progress + the precise remaining steps to launch |
| `contracts-project/` | Solidity contract, Foundry tests, compile/ABI-guard/deploy scripts |
| `frontend/` | Static site (GitHub Pages-ready) |

## Safety

- AgentSeal will **never** ask for your seed phrase, private key, API secret
  or pairing code, in any form.
- There is **no** QR-code / pairing-code login for Agentic Wallet here.
- Every transaction is previewed and confirmed by you, in your own wallet.
- Escrow rules are enforced by the contract, not by promises — read the
  owner-power disclosure above and the contract source.

## License

MIT (see contract SPDX headers).
