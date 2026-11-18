# AgentSeal — On-Chain Name-Resolution Investigation

**Target contract:** SPACE ID Agent ID (ERC-721) `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` on BNB Smart Chain (chainId 56)
**When:** 2026-11-19, ~07:33–07:45 WITA (2026-11-18 23:33–23:45 UTC)
**Method:** read-only only — `eth_call` / `eth_getLogs` / HTTP GET of public metadata. No transactions, no funds.
**Tools:** Foundry `cast` (`contracts-project/tools/cast`), node + ethers v6 (`contracts-project/node_modules/ethers`), curl, python3.

---

## 1. RPC behaviour (recorded as observed)

| Endpoint | `eth_blockNumber` / `eth_call` | `eth_getLogs` |
|---|---|---|
| `https://bsc-dataseed.binance.org` | ✅ Works (used for all `eth_call`s below) | ❌ Always `{"code": -32005, "message": "limit exceeded"}` — even for a 100-block range |
| `https://bsc-dataseed1.binance.org` (also 2/3/4) | ✅ Works | Not retried after dataseed pattern |
| `https://bsc.publicnode.com` | ✅ Works via cast/ethers | ⚠️ Flaky via raw HTTP (403 / connection closed / `IncompleteRead` on large responses); `cast logs` over a 100-block range succeeded and returned 0 logs |
| `https://bsc.api.pocket.network` | ✅ Works | ✅ **Works — used for log scans.** Max range fluctuates by backend node (observed errors: `exceed maximum block range 5000` and earlier `eth_getLogs block range too large (max 10001 blocks)`). A 4,000-block chunk succeeded reliably. Occasional read timeouts observed. |
| `https://bsc.blockrazor.xyz` | ✅ Works | ❌ `log query range must not exceed 25 blocks` |
| `https://bsc-mainnet.gateway.tatum.io` | ✅ Works | ❌ `Requested range is over limit of 100` |
| `https://bsc.meowrpc.com` | ✅ Works | ❌ HTTP 429 Too Many Requests |
| `binance.llamarpc.com`, `bsc.drpc.org`, `api.zan.top`, `rpc.ankr.com/bsc`, `bsc.rpc.blxrbdn.com`, `endpoints.omniatech.io` | ❌ Timeout / HTTP 521 / connection closed during this session | — |

Chain height references: `cast block-number` on dataseed at start = **134400143**; at probe time pocket reported **134401401**, dataseed **134401404**.

---

## 2. Finding real holders — Transfer (mint) log scan

Query (ethers v6, via `https://bsc.api.pocket.network`):

```
eth_getLogs [{
  address: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f,
  topics: [
    0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef,   // Transfer(address,address,uint256)
    0x0000000000000000000000000000000000000000000000000000000000000000    // from = zero address (mint)
  ],
  fromBlock: 134397401, toBlock: 134401401        // 4,000-block chunk
}]
```

**Result: 42 mint logs in that single 4,000-block chunk** (the token is being minted actively).
First 10 sampled mints (`to` = topic[2], `tokenId` = topic[3]):

| # | Block | Tx hash | Holder (`to`) | tokenId (decimal) |
|---|---|---|---|---|
| 0 | 134397439 | `0x03877e5fa564c0f81ce3234664c44452291228507f5b447b76aaaabed7c479f1` | `0xb8cd81672c9d7e0c0ba4c7f9d94c39cd64a2ff92` | 57171663513014867077164828345429951340986945301509218734874883976075797674952 |
| 1 | 134397477 | `0x0f620109b758d3c2d6333f47a01103b64a914b2b92faef2ac861597f33d7755c` | `0x0d7041569263cbff5dc75cf19f38b059cff892be` | 25811826997518162724712247819050383249803433183243047709625573066904777046951 |
| 2 | 134397599 | `0xd1fc9f72dc168fdf9bba62844d0ae72aedb8a5042b8895ae85513f2cbb420649` | `0x730332e883fc343c5b05e32a3bbc40a7d80932a0` | 51242266161860745031729766007471152298230997747740254618628378794792508518000 |
| 3 | 134397709 | `0x23753f2b11c1820298d147b2a423a218a11a0a8c53f64ab866cb505b66059b71` | `0x91a46a56daae0be7768068d5ce797cb775b5e99d` | 82655963739322594334976771881801337623982462906342052770596420970195778811040 |
| 4 | 134397886 | `0xdb81ad580ad20f033f0b9eaefc4795e22048bdd31b8fd67020fa744144ade9a5` | `0xcca4f387b377a14938c6ea2bd3ceb4ccebd842a0` | 29235920571270952323751303717723286744354543617084631648830938450661876574051 |
| 5 | 134398324 | `0x87a27b56bca9be17726542dbe22bee7bbef6a964d139f04b8e309da33cabc682` | `0x6bed67aa11959cc650567954603e67944b53c42c` | 56942407095922326929570285184541653945293271122528247728160411862705042721116 |
| 6 | 134398388 | `0x079d3991310746ee863d0a6295f3cfacbf6d95c20cf9fc4fab2a32d78d9de4bf` | `0xd3a110a76df8be22b64385ce9200a824b80ecb23` | 61930203783367440512308248433256443392495662168637717483237515147158433961063 |
| 7 | 134398493 | `0xf71904f24fc4844637d8f7fd4ae2762f3a035896b78922adea4511914219cb89` | `0x48a8a7548903f67afa39cfc3f160f99606167eee` | 113426725426744367558469712852968070753256877432074603203809177830416899814421 |
| 8 | 134398556 | `0x1d454491d421dad3b14efeb7cc3a05240d56ff2e7f7cba1f887c4d126eea5cd7` | `0x4209800941abfa16227a38fbc792dfdd30f93605` | 24701095492275050370400065387015645074767670171820715948146426211723646247401 |
| 9 | 134398602 | `0xa8bd5f6150acadb97dd918973a45029eae5fedddc9abe0af5b2e8b4915441634` | `0xd2cc1adbebb41711035d5eadc215f1129a40e475` | 84370570200816202290816508779085929203336572197722479545024249120988268986381 |

Note the tokenIds are huge 256-bit values, not sequential counters — first hint they are hashes (confirmed in §5).

Full raw log JSON of mint #0 (verbatim):

```json
{
  "address": "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  "topics": [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x000000000000000000000000b8cd81672c9d7e0c0ba4c7f9d94c39cd64a2ff92",
    "0x7e6603cb799dc701b84d32be736a49202cf320a5709803fd85e16ba820053bc8"
  ],
  "data": "0x",
  "blockNumber": "0x802bdff",
  "transactionHash": "0x03877e5fa564c0f81ce3234664c44452291228507f5b447b76aaaabed7c479f1",
  "transactionIndex": "0x20",
  "blockHash": "0x9bf123946871b56388fcb6c0b87396d150989a59a364f94d49a4c90ed34a405b",
  "blockTimestamp": "0x6afe3132",
  "logIndex": "0x67",
  "removed": false
}
```

**Holder-filtered lookup also works:** the same query with topic[2] = the padded holder address
(`0x000000000000000000000000b8cd81672c9d7e0c0ba4c7f9d94c39cd64a2ff92`) over blocks 134397401–134401401 returned exactly **1 log** — the mint above. So an address → tokenId lookup via logs is possible, but only within block ranges the RPC accepts (chunked scanning / an indexer is required for arbitrary-age mints).

---

## 3. Contract-level calls (exact outputs, via dataseed `eth_call`, ethers + cast cross-checked)

```
name()                                = "SPACE ID Agent ID"
symbol()                              = "AI"
supportsInterface(0x80ac58cd)         = true     // ERC721
supportsInterface(0x5b5e139f)         = true     // ERC721Metadata
supportsInterface(0x780e9d63)         = false    // ERC721Enumerable — NOT supported
supportsInterface(0x01ffc9a7)         = true     // ERC165 itself
totalSupply()                         = REVERTS
```

Cast verbatim for the failure:

```
$ cast call 0x60b9262456de011f7d15a54cdd8c48baaa8b022f "totalSupply()(uint256)" --rpc-url https://bsc-dataseed.binance.org
Error: server returned an error response: error code 3: execution reverted: 0x, data: "0x"
```

`name()` / `symbol()` are **collection-level only** ("SPACE ID Agent ID" / "AI") — they do **not** return a holder's `.ai` name.

---

## 4. Per-holder probes (exact outputs)

### Holder A — `0xB8cD81672C9d7E0c0Ba4c7F9d94C39Cd64A2FF92`

```
balanceOf(holder)                       = 1
tokenOfOwnerByIndex(holder, 0)          = REVERTS (see below)
ownerOf(57171663513014867077164828345429951340986945301509218734874883976075797674952)
                                        = 0xB8cD81672C9d7E0c0Ba4c7F9d94C39Cd64A2FF92   ✅ matches mint recipient
tokenURI(57171663513014867077164828345429951340986945301509218734874883976075797674952)
                                        = https://agentid.prd.space.id/metadata/walia1.json
```

### Holder B — `0x0d7041569263cbFf5dc75cF19f38B059CfF892Be`

```
balanceOf(holder)                       = 1
tokenOfOwnerByIndex(holder, 0)          = REVERTS (see below)
ownerOf(25811826997518162724712247819050383249803433183243047709625573066904777046951)
                                        = 0x0d7041569263cbFf5dc75cF19f38B059CfF892Be   ✅ matches mint recipient
tokenURI(25811826997518162724712247819050383249803433183243047709625573066904777046951)
                                        = https://agentid.prd.space.id/metadata/sherif01.json
```

### Holder C — `0x730332E883fc343c5B05E32a3bbC40A7d80932a0` (spot-check; balanceOf re-verified via cast = 1)

```
balanceOf(holder)                       = 1
ownerOf(51242266161860745031729766007471152298230997747740254618628378794792508518000)
                                        = 0x730332E883fc343c5B05E32a3bbC40A7d80932a0   ✅
tokenURI(51242266161860745031729766007471152298230997747740254618628378794792508518000)
                                        = https://agentid.prd.space.id/metadata/tandama.json
```

### The `tokenOfOwnerByIndex` failure (both holders, recorded verbatim)

Cast:

```
$ cast call 0x60b9262456de011f7d15a54cdd8c48baaa8b022f "tokenOfOwnerByIndex(address,uint256)(uint256)" 0x0d7041569263cbFf5dc75cF19f38B059CfF892Be 0 --rpc-url https://bsc-dataseed.binance.org
Error: server returned an error response: error code 3: execution reverted: 0x, data: "0x"
```

Ethers: `execution reverted (no data present; likely require(false) occurred … code=CALL_EXCEPTION)` — consistent with `supportsInterface(0x780e9d63) = false`. **There is no enumerable address → tokenId call on this contract.**

Additional timeboxed probes, both **revert**: `tokensOfOwner(address)`, `walletOfOwner(address)`. No other per-token name getter exists on the token contract itself; the only name-bearing read is `tokenURI`.

---

## 5. tokenURI metadata — the name IS there

`tokenURI` returns a plain HTTPS URL whose **filename slug is the label itself**, and the JSON it serves contains the label in its `name` field. Fetched with `curl` GET (HTTP 200):

Holder A — `GET https://agentid.prd.space.id/metadata/walia1.json`

```json
{"name": "walia1", "image": "https://agentid-nft.prd.space.id/prd/57171663513014867077164828345429951340986945301509218734874883976075797674952/image.png", "description": "Binance Agent Id"}
```

Holder B — `GET https://agentid.prd.space.id/metadata/sherif01.json`

```json
{"name": "sherif01", "image": "https://agentid-nft.prd.space.id/prd/25811826997518162724712247819050383249803433183243047709625573066904777046951/image.png", "description": "Binance Agent Id"}
```

Holder C — `GET https://agentid.prd.space.id/metadata/tandama.json`

```json
{"name": "tandama", "image": "https://agentid-nft.prd.space.id/prd/51242266161860745031729766007471152298230997747740254618628378794792508518000/image.png", "description": "Binance Agent Id"}
```

Fields present: `name`, `image`, `description` — nothing else. Notes:

- The JSON `name` is the **bare label without the `.ai` suffix** (`walia1`, not `walia1.ai`). The display name is `label + ".ai"` → `walia1.ai`, `sherif01.ai`, `tandama.ai`.
- The label also appears **on-chain**, in the `tokenURI` URL path itself (`…/metadata/<label>.json`) — so the name can be extracted from the `eth_call` result alone, without trusting the off-chain JSON body. The JSON fetch is a cross-check (both agree in all 3 samples).
- Quirk recorded: an HTTP **HEAD** request to the metadata URL returned **404**, while **GET returns 200** — use GET, never HEAD, against this host.

### tokenId formula — VERIFIED for all 3 holders

```
tokenId == uint256(keccak256(utf8(label)))
```

| Label | keccak256(label) | On-chain tokenId | Match |
|---|---|---|---|
| `walia1` | `0x7e6603cb799dc701b84d32be736a49202cf320a5709803fd85e16ba820053bc8` | 57171663513014867077164828345429951340986945301509218734874883976075797674952 | ✅ |
| `sherif01` | `0x3910f9f298c3f4d93de40f42f9f8556fc8a1212100fa759df4f2186c0f08bba7` | 25811826997518162724712247819050383249803433183243047709625573066904777046951 | ✅ |
| `tandama` | `0x714a18483a34225d2c8ebfd8c75b537e4e05b7fa0613ce0004ad95ec87ccee70` | 51242266161860745031729766007471152298230997747740254618628378794792508518000 | ✅ |

(Non-matches, for the record: `keccak256("walia1.ai")` and ENS `namehash("walia1.ai")` do **not** equal the tokenId.)

Forward-resolution demo (label → tokenId → owner + tokenURI, pure `eth_call`, no logs) reproduced all three holders exactly, e.g. `walia1` → tokenId above → `ownerOf` = Holder A → `tokenURI` = `…/walia1.json`.

---

## 6. VERDICT

**What a frontend CAN resolve automatically:**

1. **Holder check** — `balanceOf(address) > 0`. One `eth_call`, works on the plain dataseed RPC. ✅ (All 3 sampled holders returned exactly 1.)
2. **Name → address (forward), fully trustless, one call chain** — user supplies a label (e.g. `walia1`): compute `tokenId = keccak256(utf8(label))` locally, then `ownerOf(tokenId)` returns the holder address, and `tokenURI(tokenId)` independently confirms the label in its URL slug. No indexer, no logs, no off-chain trust. ✅ Verified end-to-end for 3 real names.
3. **tokenId → name** — `tokenURI(tokenId)`; parse the label from the on-chain URL (`…/metadata/<label>.json`), optionally GET the JSON and read its `name` field as a cross-check; display `<label>.ai`. ✅
4. **Address → tokenId → name, via logs (backend/indexer only)** — scan `Transfer` mint events (`from = 0x0`); topic[2] is the holder, topic[3] the tokenId. Proven: 42 mints in blocks 134397401–134401401, and a holder-filtered query returns exactly that holder's mint. ⚠️ Caveats: public RPCs cap `eth_getLogs` ranges hard (dataseed refuses outright; Pocket ≈5,000-block chunks, occasional timeouts), so this needs chunked backfill + ongoing indexing on a backend, not a one-shot browser call for an arbitrary old mint.

**What it CANNOT do:**

- **No single-call address → tokenId.** The contract is not ERC721Enumerable (`supportsInterface(0x780e9d63) = false`; `tokenOfOwnerByIndex` and `totalSupply` revert). A pure static frontend with only `eth_call` cannot turn a bare wallet address into its tokenId/name.
- **No on-chain per-token name string.** `name()`/`symbol()` are collection-level ("SPACE ID Agent ID" / "AI"). The label exists on-chain only inside the `tokenURI` URL string; the JSON `name` field is served off-chain by `agentid.prd.space.id` (GET-only; HEAD 404s).
- **tokenId → label cannot be inverted from the hash** (keccak is one-way) — you must go through `tokenURI` or the mint logs.

**Recommended AgentSeal flow (combines the above with the planned fallback):**

- At registration the owner **self-declares their `.ai` label** — and unlike a bare self-declaration, it is **fully verifiable in one `eth_call`**: the frontend computes `keccak256(label)`, calls `ownerOf`, and checks it equals the registering address (plus `balanceOf > 0`). A wrong/fake label simply fails the check, because only the true holder's address can pass it for that label. This keeps the original fallback's trust argument ("only that holder can register its own profile") and upgrades it to cryptographic proof — no indexer needed for the core flow.
- Use the mint-log indexer (path 4) only as an optional convenience (auto-fill the label for a connected wallet), never as a correctness dependency.

---

*Raw artefacts of this investigation (probe script outputs, full 42-mint log set) were captured during the session; all values quoted above are verbatim chain/RPC responses from the blocks cited.*
