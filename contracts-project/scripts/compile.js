#!/usr/bin/env node
// Compiles contracts/*.sol with solc-js (standard JSON), writing
// artifacts/<Name>.json with { abi, bytecode } for the test suite,
// the deploy script and BscScan-style verification records.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.join(__dirname, "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

function main() {
  const files = fs.readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith(".sol"));
  const sources = {};
  for (const f of files) {
    sources[f] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, f), "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  let hasError = false;
  for (const entry of output.errors || []) {
    const stream = entry.severity === "error" ? console.error : console.warn;
    stream(`[${entry.severity}] ${entry.formattedMessage}`);
    if (entry.severity === "error") hasError = true;
  }
  if (hasError) process.exit(1);

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, c] of Object.entries(contracts)) {
      const artifact = {
        contractName: name,
        sourceFile: file,
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object,
        deployedBytecode: "0x" + c.evm.deployedBytecode.object,
        deployedSizeBytes: c.evm.deployedBytecode.object.length / 2,
        compiler: solc.version(),
      };
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `${name}.json`), JSON.stringify(artifact, null, 2));
      console.log(`compiled ${name}: runtime size ${artifact.deployedSizeBytes} bytes (solc ${solc.version()})`);
    }
  }
}

main();
