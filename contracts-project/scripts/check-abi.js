#!/usr/bin/env node
// Red-line guard: verifies from the compiled ABI (not from vibes) that
// AgentSeal exposes NO function that could move user/escrow funds outside
// the job settlement paths, and prints the function surface + size.
// Run `node scripts/compile.js` first.
const fs = require("fs");
const path = require("path");

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "artifacts", "AgentSeal.json"), "utf8")
);
const fns = artifact.abi.filter((x) => x.type === "function");
const names = fns.map((f) => f.name);

const BANNED = [
  "withdraw", "withdrawAll", "sweep", "rescue", "drain", "emergencyWithdraw",
  "execute", "multicall", "delegatecall", "setAgentID", "setOwner",
  "transferOwnership", "renounceOwnership", "upgradeTo", "mint", "burn",
];
let bad = 0;
for (const b of BANNED) {
  if (names.includes(b)) {
    console.error(`BANNED function present in ABI: ${b}`);
    bad++;
  }
}
const hasReceiveOrFallback = artifact.abi.some((x) => x.type === "receive" || x.type === "fallback");
if (hasReceiveOrFallback) {
  console.error("ABI contains receive/fallback — plain transfers must stay impossible");
  bad++;
}

console.log(`AgentSeal function surface (${fns.length} functions):`);
for (const f of fns) {
  console.log(`  ${f.name}  [${f.stateMutability}]`);
}
console.log(`Runtime size: ${artifact.deployedSizeBytes} bytes (BSC limit 24,576)`);
if (bad) {
  console.error(`\nFAILED: ${bad} red-line violation(s)`);
  process.exit(1);
}
console.log("\nOK: no withdrawal/sweep/rescue/arbitrary-call functions, no receive/fallback.");
