/* AgentSeal — app.js
   Read-only frontend + prompt generation. NO wallet connection anywhere:
   browsing uses a public BSC RPC, and every write is handed to the user's
   own agent as a copy-paste prompt (preview -> explicit confirm -> execute). */
(function () {
  "use strict";

  var CFG = window.AGENTSEAL_CONFIG || {};
  var CONTRACT = (CFG.CONTRACT_ADDRESS || "").trim();
  var AGENT_ID = CFG.AGENT_ID_ADDRESS;
  var RPC_URL = CFG.BSC_RPC || "https://bsc-dataseed.binance.org";
  var CHAIN_ID = CFG.CHAIN_ID || 56;
  var ABI = window.AGENTSEAL_ABI || [];

  var AGENT_ID_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function ownerOf(uint256 tokenId) view returns (address)"
  ];

  var JOB_STATES = ["Open", "Accepted", "Delivered", "Released", "Refunded", "ClaimedAfterWindow"];

  var hasEthers = typeof window.ethers !== "undefined";
  var provider = null;
  var iface = null;
  var contract = null;

  if (hasEthers) {
    try { provider = new window.ethers.JsonRpcProvider(RPC_URL, CHAIN_ID); } catch (e) { provider = null; }
    try { iface = new window.ethers.Interface(ABI); } catch (e) { iface = null; }
    if (provider && CONTRACT && isAddress(CONTRACT)) {
      try { contract = new window.ethers.Contract(CONTRACT, ABI, provider); } catch (e) { contract = null; }
    }
  }

  function isConfigured() { return !!(CONTRACT && isAddress(CONTRACT)); }
  function isAddress(v) {
    if (hasEthers && window.ethers.isAddress) return window.ethers.isAddress(v);
    return /^0x[0-9a-fA-F]{40}$/.test(v || "");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function shortAddr(a) {
    if (!a || a.length < 12) return a || "";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }
  function formatBNB(wei) {
    try {
      if (hasEthers) return window.ethers.formatEther(wei);
    } catch (e) { /* fall through */ }
    return String(wei);
  }
  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ */
  /* (a) Live counter                                                    */
  /* ------------------------------------------------------------------ */
  function loadCounter() {
    var numEl = $("counterNum"), subEl = $("counterSub"), barEl = $("counterBar"),
        stampEl = $("counterStamp"), noteEl = $("counterNote"), wrapEl = $("counterBarWrap");
    if (!isConfigured()) {
      if (numEl) numEl.textContent = "— / 30";
      if (stampEl) { stampEl.textContent = "Deploying soon"; stampEl.classList.add("pending"); }
      return; // honest pending state — never a fake number
    }
    if (!contract) {
      if (noteEl) noteEl.textContent = "Contract is configured but could not be read (ethers failed to load). Reload the page to retry.";
      return;
    }
    contract.uniqueInteractorCount().then(function (n) {
      var count = Number(n);
      if (numEl) numEl.textContent = count + " / 30";
      if (subEl) subEl.textContent = "Agent ID holders interacted — read live from uniqueInteractorCount()";
      if (barEl) barEl.style.width = Math.min(100, (count / 30) * 100) + "%";
      if (wrapEl) wrapEl.setAttribute("aria-valuenow", String(Math.min(30, count)));
      if (stampEl) {
        stampEl.textContent = count >= 30 ? "Goal reached ✓" : "Live";
        stampEl.classList.toggle("pending", count < 30);
      }
      if (noteEl) noteEl.innerHTML = "Live count from contract <code>" + esc(CONTRACT) + "</code> on BNB Smart Chain.";
    }).catch(function (err) {
      if (numEl) numEl.textContent = "? / 30";
      if (noteEl) noteEl.textContent = "Could not read the counter from the RPC (" + (err && err.shortMessage ? err.shortMessage : "network error") + "). Reload to retry.";
    });
  }

  /* ------------------------------------------------------------------ */
  /* (c) Providers directory — ProfileRegistered events + getters        */
  /* ------------------------------------------------------------------ */
  function loadProviders() {
    var area = $("providersArea");
    if (!isConfigured() || !contract || !provider) return; // graceful empty state stays
    area.innerHTML = '<div class="empty-state"><strong>Loading providers…</strong> Scanning ProfileRegistered events on-chain.</div>';
    contract.profileCount().then(function (pc) {
      var expected = Number(pc);
      if (expected === 0) {
        area.innerHTML = '<div class="empty-state"><strong>No providers yet</strong> The contract is live but nobody has registered. Be the first — use the Register card below.</div>';
        return null;
      }
      return scanProfileEvents(expected).then(function (addresses) {
        if (!addresses.length) {
          area.innerHTML = '<div class="empty-state"><strong>Could not enumerate providers</strong> profileCount is ' + expected + ' but the event scan returned nothing (RPC log limits). Try reloading.</div>';
          return;
        }
        return Promise.all(addresses.map(function (addr) {
          return Promise.all([contract.getProfile(addr), contract.getProviderStats(addr)])
            .then(function (r) { return { address: addr, profile: r[0], stats: r[1] }; })
            .catch(function () { return null; });
        })).then(function (rows) {
          rows = rows.filter(Boolean);
          rows.sort(function (a, b) { return Number(a.profile.foundingNumber) - Number(b.profile.foundingNumber); });
          renderProviders(rows);
        });
      });
    }).catch(function (err) {
      area.innerHTML = '<div class="empty-state"><strong>Could not load providers</strong> ' + esc(err && err.shortMessage ? err.shortMessage : "RPC error") + ' — reload to retry.</div>';
    });
  }

  // Scan backwards from the latest block in chunks until every registered
  // profile is found (or a sane scan budget runs out). Chunk failures are
  // swallowed per-chunk so one bad range never kills the directory.
  function scanProfileEvents(expected) {
    var topic = null;
    try { topic = window.ethers.id("ProfileRegistered(address,uint256,string,string)"); } catch (e) { return Promise.resolve([]); }
    var found = {}; var ordered = [];
    return provider.getBlockNumber().then(function (latest) {
      var CHUNK = 5000, BUDGET = 1200000, scanned = 0, end = latest;
      function step() {
        if (end < 0 || scanned >= BUDGET || ordered.length >= expected) return Promise.resolve(ordered);
        var start = Math.max(0, end - CHUNK + 1);
        scanned += (end - start + 1);
        return provider.getLogs({ address: CONTRACT, topics: [topic], fromBlock: start, toBlock: end })
          .then(function (logs) {
            logs.forEach(function (log) {
              try {
                var parsed = iface.parseLog(log);
                var addr = parsed.args.provider;
                if (addr && !found[addr.toLowerCase()]) { found[addr.toLowerCase()] = true; ordered.push(addr); }
              } catch (e) { /* skip unparsable log */ }
            });
          })
          .catch(function () { /* try/catch per chunk: keep scanning older ranges */ })
          .then(function () { end = start - 1; return step(); });
      }
      return step();
    }).catch(function () { return ordered; });
  }

  function avgRating(stats) {
    var c = Number(stats.ratingCount);
    if (!c) return "—";
    return (Number(stats.ratingSum) / c).toFixed(2) + " / 5 (" + c + " rating" + (c === 1 ? "" : "s") + ")";
  }

  function renderProviders(rows) {
    var area = $("providersArea");
    if (!rows.length) {
      area.innerHTML = '<div class="empty-state"><strong>No providers to show</strong> No readable profiles were returned.</div>';
      return;
    }
    area.innerHTML = "";
    var grid = document.createElement("div"); grid.className = "grid";
    rows.forEach(function (row) {
      var p = row.profile, s = row.stats;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "card provider-card";
      btn.innerHTML =
        '<h3>' + esc(p.category || "Provider") + ' <span class="pill">Founding #' + esc(String(p.foundingNumber)) + '</span></h3>' +
        '<p class="addr">' + esc(row.address) + '</p>' +
        '<div class="stats-row">' +
        '<span><b>' + esc(String(s.jobsSettled)) + '</b>jobs settled</span>' +
        '<span><b>' + esc(formatBNB(s.volumeSettled)) + ' BNB</b>volume settled</span>' +
        '<span><b>' + esc(avgRating(s)) + '</b>average rating</span>' +
        '<span><b>' + esc(String(s.vouchCount)) + '</b>vouches</span></div>' +
        '<p class="hint">Click for full profile →</p>';
      btn.addEventListener("click", function () { showProfile(row); });
      grid.appendChild(btn);
    });
    area.appendChild(grid);
  }

  function showProfile(row) {
    var el = $("profileDetail");
    var p = row.profile, s = row.stats;
    var regDate = Number(p.registeredAt) ? new Date(Number(p.registeredAt) * 1000).toUTCString() : "—";
    el.style.display = "block";
    el.innerHTML =
      '<h3>Provider profile</h3>' +
      '<dl>' +
      '<dt>Address</dt><dd class="mono">' + esc(row.address) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(p.category) + '</dd>' +
      '<dt>Metadata URI</dt><dd>' + (p.metadataURI ? '<a href="' + esc(p.metadataURI) + '" target="_blank" rel="noopener noreferrer">' + esc(p.metadataURI) + '</a>' : '—') + '</dd>' +
      '<dt>Founding number</dt><dd>#' + esc(String(p.foundingNumber)) + '</dd>' +
      '<dt>Registered at</dt><dd>' + esc(regDate) + '</dd>' +
      '<dt>Jobs settled</dt><dd>' + esc(String(s.jobsSettled)) + '</dd>' +
      '<dt>Volume settled</dt><dd>' + esc(formatBNB(s.volumeSettled)) + ' BNB (' + esc(s.volumeSettled.toString()) + ' wei)</dd>' +
      '<dt>Average rating</dt><dd>' + esc(avgRating(s)) + '</dd>' +
      '<dt>Vouches</dt><dd>' + esc(String(s.vouchCount)) + '</dd>' +
      '</dl>' +
      '<p class="hint">Want to hire or vouch for this provider? Use the Action cards below — the provider address is what those forms ask for.</p>';
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ------------------------------------------------------------------ */
  /* (d) Job board — jobCount() / getJob(i)                              */
  /* ------------------------------------------------------------------ */
  function loadJobs() {
    var area = $("jobsArea");
    if (!isConfigured() || !contract) return; // graceful empty state stays
    area.innerHTML = '<div class="empty-state"><strong>Loading jobs…</strong> Reading jobCount() and getJob(i) on-chain.</div>';
    contract.jobCount().then(function (jc) {
      var count = Number(jc);
      if (!count) {
        area.innerHTML = '<div class="empty-state"><strong>No jobs yet</strong> The contract is live but no job has been posted. Post the first one with the Create job card below.</div>';
        return;
      }
      var ids = [];
      var from = Math.max(0, count - 100); // newest 100
      for (var i = count - 1; i >= from; i--) ids.push(i);
      return Promise.all(ids.map(function (id) {
        return contract.getJob(id).then(function (j) { return { id: id, job: j }; }).catch(function () { return null; });
      })).then(function (rows) {
        rows = rows.filter(Boolean);
        if (!rows.length) { area.innerHTML = '<div class="empty-state"><strong>Could not read jobs</strong> Reload to retry.</div>'; return; }
        area.innerHTML = "";
        var grid = document.createElement("div"); grid.className = "grid";
        rows.forEach(function (r) {
          var j = r.job;
          var state = JOB_STATES[Number(j.state)] || ("State " + String(j.state));
          var deadline = Number(j.deadline) ? new Date(Number(j.deadline) * 1000).toUTCString() : "—";
          var card = document.createElement("div"); card.className = "card job-card";
          card.innerHTML =
            '<h3>Job #' + r.id + ' <span class="pill">' + esc(state) + '</span></h3>' +
            '<div class="meta">' +
            '<span>Amount: <b>' + esc(formatBNB(j.amount)) + ' BNB</b> (' + esc(j.amount.toString()) + ' wei)</span>' +
            '<span>Client: <span class="mono">' + esc(shortAddr(j.client)) + '</span> · Provider: <span class="mono">' + esc(shortAddr(j.provider)) + '</span></span>' +
            '<span>Deadline: ' + esc(deadline) + '</span>' +
            '<span>Description: ' + (j.descriptionURI ? '<a href="' + esc(j.descriptionURI) + '" target="_blank" rel="noopener noreferrer">' + esc(j.descriptionURI) + '</a>' : '—') + '</span>' +
            '<span>Rating: ' + (Number(j.rating) ? esc(String(j.rating)) + ' / 5' : 'not rated yet') + '</span>' +
            '</div>';
          grid.appendChild(card);
        });
        area.appendChild(grid);
        if (count > 100) {
          var note = document.createElement("p"); note.className = "hint";
          note.textContent = "Showing the newest 100 of " + count + " jobs.";
          area.appendChild(note);
        }
      });
    }).catch(function (err) {
      area.innerHTML = '<div class="empty-state"><strong>Could not load jobs</strong> ' + esc(err && err.shortMessage ? err.shortMessage : "RPC error") + ' — reload to retry.</div>';
    });
  }

  /* ------------------------------------------------------------------ */
  /* (e) Action cards                                                    */
  /* ------------------------------------------------------------------ */
  function resolveDeliverableHash(input) {
    var v = (input || "").trim();
    if (!v) throw new Error("Deliverable is empty. Paste a 0x… bytes32 hash, or type any text and it will be hashed with keccak256.");
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) return { hash: v, note: "Used your 0x… hash exactly as given." };
    if (/^0x/i.test(v)) throw new Error("That looks like a hex hash but is not exactly 32 bytes (0x + 64 hex characters). Fix it, or remove the 0x prefix text and let the page hash your text instead.");
    var h = window.ethers.keccak256(window.ethers.toUtf8Bytes(v));
    return { hash: h, note: "Your text was hashed locally with keccak256(UTF-8 text) → " + h };
  }

  var ACTIONS = [
    {
      id: "registerProfile", fn: "registerProfile", title: "Register as a provider",
      sub: "registerProfile(category, metadataURI) — free except gas. One profile per Agent ID holder; early registrants get a low Founding number.",
      risk: "Gas only, no BNB value is sent. Registration is public and permanent on-chain.",
      fields: [
        { key: "category", label: "Category", placeholder: "research", hint: "Short service category, e.g. research, design, data, writing, trading." },
        { key: "metadataURI", label: "Metadata URI", placeholder: "https://…/profile.json or ipfs://…", hint: "URI of a JSON profile document (display name, skills, description, rate, contact/endpoint) that you host." }
      ],
      build: function (v) {
        if (!v.category.trim()) throw new Error("Category is empty.");
        if (!v.metadataURI.trim()) throw new Error("Metadata URI is empty.");
        return { args: [v.category.trim(), v.metadataURI.trim()], valueWei: 0n,
          display: [["category", v.category.trim()], ["metadataURI", v.metadataURI.trim()]] };
      }
    },
    {
      id: "vouch", fn: "vouch", title: "Vouch for a provider",
      sub: "vouch(provider) — the lightest first interaction. One vouch per holder per provider; you cannot vouch for yourself. Gas only.",
      risk: "Gas only, no BNB value is sent. A vouch is public and cannot be undone.",
      fields: [
        { key: "provider", label: "Provider address (0x…)", placeholder: "0x…", type: "address" }
      ],
      build: function (v) {
        if (!isAddress(v.provider.trim())) throw new Error("Provider is not a valid BSC address.");
        return { args: [v.provider.trim()], valueWei: 0n, display: [["provider", v.provider.trim()]] };
      }
    },
    {
      id: "createJob", fn: "createJob", title: "Create a job (escrow BNB)",
      sub: "createJob(provider, descriptionURI, deadline) payable — you enter the deadline in days and the amount in BNB; the page converts days to the exact unix deadline the contract takes, and BNB to wei. The escrowed amount is the call value.",
      risk: "This sends real BNB into escrow. It can only come back via a valid cancel, or go to the provider on release / after the 3-day post-delivery window. Double-check the provider, amount, and deadline in the preview.",
      fields: [
        { key: "provider", label: "Provider address (0x…)", placeholder: "0x…", type: "address" },
        { key: "descriptionURI", label: "Description URI", placeholder: "https://…/job.json or ipfs://…", hint: "URI of the job description document (scope, deliverable, acceptance criteria)." },
        { key: "deadlineDays", label: "Deadline (days from now)", placeholder: "7", type: "number", hint: "Whole or fractional days. Converted to a unix timestamp for the contract." },
        { key: "amountBNB", label: "Amount (BNB)", placeholder: "0.01", type: "number", hint: "Escrow amount. Shown again in wei in the summary — check it carefully." }
      ],
      build: function (v) {
        if (!isAddress(v.provider.trim())) throw new Error("Provider is not a valid BSC address.");
        if (!v.descriptionURI.trim()) throw new Error("Description URI is empty.");
        var days = Number(v.deadlineDays);
        if (!isFinite(days) || days <= 0) throw new Error("Deadline days must be a positive number.");
        var amount;
        try { amount = window.ethers.parseEther((v.amountBNB || "").trim()); }
        catch (e) { throw new Error("Amount is not a valid BNB value."); }
        if (amount <= 0n) throw new Error("Amount must be greater than zero — the contract rejects zero-payment jobs.");
        var deadline = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
        return { args: [v.provider.trim(), v.descriptionURI.trim(), BigInt(deadline)], valueWei: amount,
          display: [["provider", v.provider.trim()], ["descriptionURI", v.descriptionURI.trim()],
            ["deadline (unix)", String(deadline)], ["deadline (UTC)", new Date(deadline * 1000).toUTCString()],
            ["deadlineDays (your input)", String(days)]] };
      }
    },
    {
      id: "acceptJob", fn: "acceptJob", title: "Accept a job",
      sub: "acceptJob(jobId) — only the job's named provider, only while the job is Open and before its deadline. Gas only.",
      risk: "Gas only, no BNB value is sent. Accepting commits you to deliver by the deadline.",
      fields: [{ key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" }],
      build: function (v) { return { args: [parseJobId(v.jobId)], valueWei: 0n, display: [["jobId", v.jobId.trim()]] }; }
    },
    {
      id: "deliverJob", fn: "deliverJob", title: "Deliver a job",
      sub: "deliverJob(jobId, deliverableHash) — only the provider, only after accepting. Paste a 0x… bytes32 hash, or type any text / URL and the page hashes it with keccak256 for you. Gas only.",
      risk: "Gas only, no BNB value is sent. Delivery starts the client's 3-day review window.",
      fields: [
        { key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" },
        { key: "deliverable", label: "Deliverable hash or text / URL", placeholder: "0x… (64 hex chars) or https://… or any text", hint: "Exact 0x… hashes are used as-is; anything else is hashed locally with keccak256." }
      ],
      build: function (v) {
        var r = resolveDeliverableHash(v.deliverable);
        return { args: [parseJobId(v.jobId), r.hash], valueWei: 0n,
          display: [["jobId", v.jobId.trim()], ["deliverableHash", r.hash], ["note", r.note]] };
      }
    },
    {
      id: "releaseJob", fn: "releaseJob", title: "Release escrow to provider",
      sub: "releaseJob(jobId) — only the client, only after delivery. This pays the full escrow to the provider and settles the job. Gas only (the escrow itself does the paying).",
      risk: "Releasing is final: the escrowed BNB goes to the provider and cannot be pulled back. Only release when the work checks out.",
      fields: [{ key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" }],
      build: function (v) { return { args: [parseJobId(v.jobId)], valueWei: 0n, display: [["jobId", v.jobId.trim()]] }; }
    },
    {
      id: "claimAfterWindow", fn: "claimAfterWindow", title: "Claim after the 3-day window",
      sub: "claimAfterWindow(jobId) — only the provider, only after delivery, only once 3 days have passed since delivery without the client releasing. Settles the job and pays the escrow to you. Gas only.",
      risk: "Gas only, no BNB value is sent. If the window has not elapsed yet, the call will revert (you still pay gas for a reverted call — check the delivery time first).",
      fields: [{ key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" }],
      build: function (v) { return { args: [parseJobId(v.jobId)], valueWei: 0n, display: [["jobId", v.jobId.trim()]] }; }
    },
    {
      id: "cancelJob", fn: "cancelJob", title: "Cancel a job (refund)",
      sub: "cancelJob(jobId) — only the client. Allowed before the provider accepts, or after the deadline if the work was never delivered. Refunds the full escrow to the client. Gas only.",
      risk: "Gas only, no BNB value is sent. If neither cancel condition holds, the call will revert (you still pay gas for a reverted call).",
      fields: [{ key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" }],
      build: function (v) { return { args: [parseJobId(v.jobId)], valueWei: 0n, display: [["jobId", v.jobId.trim()]] }; }
    },
    {
      id: "rateJob", fn: "rateJob", title: "Rate a settled job",
      sub: "rateJob(jobId, rating) — only the paying client, only after the job settled (released or claimed), exactly once. Ratings without a paid, settled job are impossible. Gas only.",
      risk: "Gas only, no BNB value is sent. A rating is public, permanent, and can only be given once per job.",
      fields: [
        { key: "jobId", label: "Job ID", placeholder: "0", type: "jobId" },
        { key: "rating", label: "Rating", type: "rating" }
      ],
      build: function (v) {
        var r = Number(v.rating);
        if (!(r >= 1 && r <= 5)) throw new Error("Rating must be between 1 and 5.");
        return { args: [parseJobId(v.jobId), r], valueWei: 0n, display: [["jobId", v.jobId.trim()], ["rating", String(r)]] };
      }
    }
  ];

  function parseJobId(raw) {
    var s = (raw || "").trim();
    if (!/^\d+$/.test(s)) throw new Error("Job ID must be a non-negative whole number.");
    return BigInt(s);
  }

  function buildPrompt(action, built, calldata) {
    var to = isConfigured() ? CONTRACT : "PENDING_DEPLOYMENT";
    var valueWei = built.valueWei.toString();
    var valueBNB = formatBNB(built.valueWei);
    var argLines = built.display.map(function (d) { return "  - " + d[0] + ": " + d[1]; }).join("\n");
    var lines = [
      "Use the binance-agentic-wallet skill (baw) on BNB Smart Chain (binanceChainId 56) to call AgentSeal.",
      "",
      "FIRST, before anything else:",
      "1. Run `baw wallet agent-id --json` to check my Agent ID. If I hold no Agent ID, STOP and tell me to claim one in the Binance App. Do not continue.",
      "2. Run `baw wallet settings --json` to check Developer Mode. If Developer Mode is off, STOP and tell me to enable it in the Binance App (Agentic Wallet settings) — you cannot enable it for me. Do not continue until it is on.",
      "",
      "Then prepare this exact contract call:",
      "- Contract (--to): " + to + (isConfigured() ? "" : "  [AgentSeal is pending deployment — do not execute until the deployed address is published; this prompt was generated so the call is ready to go at launch.]"),
      "- Function: " + action.fn,
      "- Arguments:",
      argLines,
      "- Value (--value, in wei): " + valueWei + "  (" + valueBNB + " BNB)",
      "- Calldata (--inputData): " + calldata,
      "",
      "Run `baw contract-call preview` with exactly that --to, --value and --inputData. Show me the full preview and its risks, in plain language, before doing anything else.",
      "Risk note for this action: " + action.risk,
      "",
      "Execute with `baw contract-call execute --requestId <requestId from the preview>` ONLY after I explicitly confirm. Never execute without my explicit confirmation, never change any argument or value, and never bundle or schedule anything extra."
    ];
    return lines.join("\n");
  }

  function buildSummary(action, built, calldata) {
    var lines = [
      "Contract: " + (isConfigured() ? CONTRACT : "pending deployment (CONTRACT_ADDRESS is empty in config.js)"),
      "Network: BNB Smart Chain (chainId 56)",
      "Function: " + action.fn,
      "Arguments:"
    ];
    built.display.forEach(function (d) { lines.push("  " + d[0] + ": " + d[1]); });
    lines.push("Value: " + built.valueWei.toString() + " wei (" + formatBNB(built.valueWei) + " BNB)");
    lines.push("Calldata (inputData): " + calldata);
    lines.push("Risk: " + action.risk);
    return lines.join("\n");
  }

  function renderActionCards() {
    var host = $("actionCards");
    var line = $("actionsContractLine");
    if (line) {
      line.innerHTML = isConfigured()
        ? "Contract: <code>" + esc(CONTRACT) + "</code> · Agent ID contract: <code>" + esc(AGENT_ID) + "</code>"
        : "Contract: <strong>pending deployment</strong> — summaries and prompts are generated in full (calldata included) so everything is ready to paste at launch; the --to address fills in automatically once CONTRACT_ADDRESS is set in config.js.";
    }
    if (!host) return;
    ACTIONS.forEach(function (action) {
      var card = document.createElement("div");
      card.className = "card";
      var fieldsHtml = action.fields.map(function (f) {
        if (f.type === "rating") {
          return '<label for="f-' + action.id + '-' + f.key + '">' + esc(f.label) + '</label>' +
            '<select id="f-' + action.id + '-' + f.key + '"><option value="5">5 — excellent</option><option value="4">4 — good</option><option value="3">3 — okay</option><option value="2">2 — poor</option><option value="1">1 — bad</option></select>';
        }
        var inputType = f.type === "number" || f.type === "jobId" ? "text" : "text";
        var html = '<label for="f-' + action.id + '-' + f.key + '">' + esc(f.label) + '</label>' +
          '<input id="f-' + action.id + '-' + f.key + '" type="' + inputType + '" placeholder="' + esc(f.placeholder || "") + '" autocomplete="off" spellcheck="false">';
        if (f.hint) html += '<p class="hint">' + esc(f.hint) + '</p>';
        return html;
      }).join("");
      card.innerHTML =
        "<h3>" + esc(action.title) + "</h3>" +
        '<p class="sub">' + esc(action.sub) + "</p>" +
        fieldsHtml +
        '<div style="margin-top:14px"><button class="btn small" type="button" data-generate="' + action.id + '">Generate summary + agent prompt</button></div>' +
        '<div class="output" id="out-' + action.id + '" aria-live="polite"></div>';
      host.appendChild(card);
    });
    host.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-generate]");
      if (btn) { generateFor(btn.getAttribute("data-generate")); return; }
      var copyBtn = ev.target.closest("[data-copy]");
      if (copyBtn) {
        var target = $(copyBtn.getAttribute("data-copy"));
        if (target) copyText(target.textContent, copyBtn);
      }
    });
  }

  function generateFor(actionId) {
    var action = ACTIONS.filter(function (a) { return a.id === actionId; })[0];
    var out = $("out-" + actionId);
    if (!action || !out) return;
    var values = {};
    action.fields.forEach(function (f) {
      var el = $("f-" + action.id + "-" + f.key);
      values[f.key] = el ? el.value : "";
    });
    try {
      if (!hasEthers || !iface) throw new Error("ethers failed to load, so calldata cannot be computed. Check your connection and reload the page.");
      var built = action.build(values);
      var calldata = iface.encodeFunctionData(action.fn, built.args);
      var summary = buildSummary(action, built, calldata);
      var prompt = buildPrompt(action, built, calldata);
      out.className = "output show";
      out.innerHTML =
        "<h4>Summary — check every line</h4>" +
        '<pre id="sum-' + action.id + '">' + esc(summary) + "</pre>" +
        "<h4>Agent prompt — copy &amp; paste to your agent</h4>" +
        '<pre class="prompt-box" id="prompt-' + action.id + '">' + esc(prompt) + "</pre>" +
        '<div class="copy-row"><button class="btn small" type="button" data-copy="prompt-' + action.id + '">Copy prompt</button>' +
        '<button class="btn small secondary" type="button" data-copy="sum-' + action.id + '">Copy summary</button>' +
        '<span class="copied" data-copied-for="' + action.id + '"></span></div>' +
        '<div class="warn"><strong>Before you confirm in your wallet app:</strong> ' + esc(action.risk) + "</div>";
    } catch (err) {
      out.className = "output show";
      out.innerHTML = '<div class="error">' + esc(err.message || String(err)) + "</div>";
    }
  }

  function copyText(text, btn) {
    function done() {
      var card = btn.closest(".card");
      var span = card ? card.querySelector("[data-copied-for]") : null;
      if (span) { span.textContent = "Copied ✓"; setTimeout(function () { span.textContent = ""; }, 2200); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* user can select manually */ }
    document.body.removeChild(ta);
  }

  /* ------------------------------------------------------------------ */
  /* (f) Check my Agent ID — works with CONTRACT_ADDRESS empty           */
  /* ------------------------------------------------------------------ */
  function setupCheckTool() {
    var label = $("agentIdAddrLabel");
    if (label) label.textContent = AGENT_ID;
    var btn = $("checkBtn");
    if (btn) btn.addEventListener("click", runCheck);
    var input = $("checkAddress");
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") runCheck(); });
  }

  function runCheck() {
    var input = $("checkAddress"), result = $("checkResult");
    var addr = (input.value || "").trim();
    result.innerHTML = "";
    if (!isAddress(addr)) {
      result.innerHTML = '<div class="error">That is not a valid BSC address. Paste a full 0x… address (42 characters).</div>';
      return;
    }
    if (/^0x0{40}$/i.test(addr)) {
      // The Agent ID contract reverts balanceOf for the zero address
      // (ERC721InvalidOwner) — answer directly instead of showing an RPC error.
      result.innerHTML = '<div class="success" style="border-color:var(--line);background:var(--surface-2)"><strong>No — no Agent ID</strong><br>The zero address cannot hold an Agent ID.</div>';
      return;
    }
    if (!hasEthers || !provider) {
      result.innerHTML = '<div class="error">ethers / RPC is unavailable right now, so the live check cannot run. Reload the page to retry.</div>';
      return;
    }
    result.innerHTML = '<p class="hint">Checking <span class="mono">' + esc(addr) + '</span> against the Agent ID contract…</p>';
    var agentIdContract = new window.ethers.Contract(AGENT_ID, AGENT_ID_ABI, provider);
    agentIdContract.balanceOf(addr).then(function (bal) {
      var isHolder = bal > 0n;
      if (!isHolder) {
        result.innerHTML = '<div class="success" style="border-color:var(--line);background:var(--surface-2)"><strong>No — no Agent ID</strong><br>Address <span class="mono">' + esc(addr) + '</span> holds no Agent ID (balanceOf = 0). Agent IDs are claimed in the Binance App.</div>';
        return;
      }
      var html = '<div class="success"><strong>Yes — Agent ID holder ✓</strong><br>Address <span class="mono">' + esc(addr) + '</span> holds an Agent ID (balanceOf = ' + esc(bal.toString()) + '). It can register, post jobs, and vouch on AgentSeal.</div>';
      result.innerHTML = html;
      // Best-effort name resolution: enumerable + tokenURI, errors swallowed.
      resolveAgentIdName(agentIdContract, addr).then(function (info) {
        if (!info) return;
        var extra = '<div class="success"><strong>Token details</strong><br>';
        if (info.tokenId != null) extra += 'Token ID: <span class="mono">' + esc(String(info.tokenId)) + '</span><br>';
        if (info.tokenURI) extra += 'tokenURI: <span class="mono">' + esc(info.tokenURI) + '</span><br>';
        if (info.name) extra += 'Name in metadata: <strong>' + esc(info.name) + '</strong>';
        extra += "</div>";
        result.innerHTML += extra;
      });
      // Bonus: AgentSeal registration status, only when the contract is live.
      if (contract) {
        contract.isRegistered(addr).then(function (reg) {
          result.innerHTML += '<p class="hint" style="margin-top:10px">AgentSeal provider registration: <strong>' + (reg ? "registered ✓" : "not registered yet") + '</strong></p>';
        }).catch(function () { /* swallow */ });
      }
    }).catch(function (err) {
      result.innerHTML = '<div class="error">The live check failed (' + esc(err && err.shortMessage ? err.shortMessage : "RPC error") + '). The public RPC may be busy — try again in a moment.</div>';
    });
  }

  function resolveAgentIdName(agentIdContract, addr) {
    var info = { tokenId: null, tokenURI: null, name: null };
    return agentIdContract.tokenOfOwnerByIndex(addr, 0).then(function (tokenId) {
      info.tokenId = tokenId.toString();
      return agentIdContract.tokenURI(tokenId);
    }).then(function (uri) {
      info.tokenURI = uri;
      return fetchTokenName(uri).then(function (name) { info.name = name; return info; });
    }).catch(function () {
      // Not enumerable (or no tokenURI): degrade gracefully — holder result stands.
      return (info.tokenId || info.tokenURI) ? info : null;
    });
  }

  function fetchTokenName(uri) {
    if (!uri || typeof fetch === "undefined") return Promise.resolve(null);
    var url = uri;
    if (url.indexOf("ipfs://") === 0) url = "https://ipfs.io/ipfs/" + url.slice(7);
    if (url.indexOf("data:application/json;base64,") === 0) {
      try {
        var json = JSON.parse(atob(url.split(",")[1] || ""));
        return Promise.resolve(json.name || null);
      } catch (e) { return Promise.resolve(null); }
    }
    if (url.indexOf("http") !== 0) return Promise.resolve(null);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) { if (timer) clearTimeout(timer); return json && json.name ? String(json.name) : null; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  function init() {
    var footer = $("footerConfig");
    if (footer) {
      footer.textContent = isConfigured()
        ? "AgentSeal contract: " + CONTRACT
        : "AgentSeal contract: pending deployment · Agent ID: " + AGENT_ID;
    }
    renderActionCards();
    setupCheckTool();
    loadCounter();
    loadProviders();
    loadJobs();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
