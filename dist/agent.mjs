var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// dist/sales-model.js
var init_sales_model = __esm({
  "dist/sales-model.js"() {
  }
});

// dist/engine.js
function quote(product, supplier, quantity) {
  return Math.floor((product.cost * Math.round(supplier.multiplier * 100) * (quantity >= 24 ? 92 : 100) + 5e3) / 1e4);
}
function validateDecision(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Decision must be an object.");
  if (typeof d.rationale !== "string" || d.rationale.length > 2e3 || typeof d.memory !== "string" || d.memory.length > 6e3) throw new Error("Invalid rationale or memory.");
  for (const key of ["prices", "load"]) {
    if (!d[key] || typeof d[key] !== "object" || Array.isArray(d[key])) throw new Error(`Missing ${key}.`);
    for (const [id, value] of Object.entries(d[key])) {
      if (!PRODUCTS.some((p) => p.id === id) || !Number.isInteger(value) || value < (key === "prices" ? 25 : 0) || value > (key === "prices" ? 2e3 : 30)) throw new Error(`Invalid ${key}: ${id}`);
    }
  }
  if (!Array.isArray(d.orders) || d.orders.length > 12) throw new Error("Invalid orders.");
  for (const o of d.orders) {
    if (!o || !PRODUCTS.some((p) => p.id === o.product) || !SUPPLIERS.some((p) => p.id === o.supplier) || !Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > 120) throw new Error("Invalid order.");
  }
  return d;
}
var PRODUCTS, SUPPLIERS, ECONOMY, money;
var init_engine = __esm({
  "dist/engine.js"() {
    init_sales_model();
    PRODUCTS = [
      { id: "water", name: "Spring water", icon: "\u{1F4A7}", cost: 45, retail: 150, category: "drink" },
      { id: "cola", name: "Cola", icon: "\u{1F964}", cost: 70, retail: 200, category: "drink" },
      { id: "coffee", name: "Cold brew", icon: "\u2615", cost: 120, retail: 320, category: "drink" },
      { id: "chips", name: "Sea salt chips", icon: "\u{1F954}", cost: 65, retail: 180, category: "snack" },
      { id: "bar", name: "Protein bar", icon: "\u{1F36B}", cost: 105, retail: 280, category: "snack" },
      { id: "nuts", name: "Trail mix", icon: "\u{1F95C}", cost: 90, retail: 250, category: "snack" }
    ];
    SUPPLIERS = [
      { id: "express", name: "Metro Express", multiplier: 1.15, lead: 1, delay: 0.02 },
      { id: "wholesale", name: "Bay Wholesale", multiplier: 1, lead: 2, delay: 0.08 },
      { id: "budget", name: "Budget Depot", multiplier: 0.82, lead: 4, delay: 0.22 }
    ];
    ECONOMY = Object.freeze({ currency: "USDC", unitsPerUsdc: 1e5, microsPerUnit: 10, tokenDecimals: 6, stake: 5e4, capital: 5e4, dailyFee: 200 });
    money = (units) => (units / ECONOMY.unitsPerUsdc).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 5 });
  }
});

// lib/arc.mjs
import { arcTestnet } from "viem/chains";
import { isAddress, keccak256, toHex, zeroHash } from "viem";
function dayPermit(observation, decision) {
  validateDecision(decision);
  const prices = PRODUCTS.map((p) => decision.prices[p.id] ?? observation.self.prices[p.id]);
  const financial = { prices, load: PRODUCTS.map((p) => decision.load[p.id] ?? 0), orders: decision.orders.map((o) => ({ product: o.product, supplier: o.supplier, quantity: o.quantity })) };
  const maxSupplySpend = decision.orders.reduce((sum, o) => sum + quote(PRODUCTS.find((p) => p.id === o.product), SUPPLIERS.find((s) => s.id === o.supplier), o.quantity) * o.quantity, 0);
  return { decisionHash: keccak256(toHex(JSON.stringify(financial))), maxSupplySpend, prices };
}
function dayTypedData(config, { seasonId, day, ...permit }) {
  return { domain: domain(config), primaryType: "Day", types: { Day: [{ name: "seasonId", type: "uint256" }, { name: "day", type: "uint32" }, { name: "decisionHash", type: "bytes32" }, { name: "maxSupplySpend", type: "uint64" }, { name: "prices", type: "uint32[6]" }] }, message: { seasonId: Number(seasonId), day, ...permit } };
}
var ARC_CHAIN, ARC_USDC, stringify, arcErrorMessage, domain;
var init_arc = __esm({
  "lib/arc.mjs"() {
    init_engine();
    ARC_CHAIN = { ...arcTestnet, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } }, blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } } };
    ARC_USDC = "0x3600000000000000000000000000000000000000";
    stringify = (value) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
    arcErrorMessage = (error) => String(error?.shortMessage || error?.message || "Arc unavailable").split("\n")[0].replace(/https?:\/\/\S+/gi, "[RPC]").slice(0, 300);
    domain = (config) => ({ name: "AutoBazaar", version: "1", chainId: config.chainId ?? config.chain.id, verifyingContract: config.contract });
  }
});

// lib/codex-binary.mjs
import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
async function entries(path) {
  try {
    return (await readdir(path)).sort((a, b) => b.localeCompare(a, void 0, { numeric: true }));
  } catch {
    return [];
  }
}
async function resolveCodexBinary({ binary = process.env.CODEX_BIN, env = process.env, home = homedir(), platform = process.platform, arch = process.arch, nodePath = process.execPath, cwd = process.cwd() } = {}) {
  const name = platform === "win32" ? "codex.exe" : "codex";
  const pathCandidates = (command) => (env.PATH || "").split(delimiter).filter(Boolean).map((p) => resolve(cwd, p, command));
  if (binary) {
    const candidates2 = isAbsolute(binary) || /[\\/]/.test(binary) ? [resolve(cwd, binary)] : pathCandidates(binary);
    for (const path of candidates2) if (await executable(path)) return path;
    throw new Error("CODEX_BIN does not point to an executable Codex binary. Set CODEX_BIN to its absolute path, then restart the server.");
  }
  const candidates = [...pathCandidates(name), join(dirname(nodePath), name), join(home, ".local", "bin", name), join(home, ".npm-global", "bin", name), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
  if (platform === "darwin") candidates.push("/Applications/Codex.app/Contents/Resources/codex", join(home, "Applications/Codex.app/Contents/Resources/codex"));
  const nvm = join(home, ".nvm", "versions", "node");
  for (const version of await entries(nvm)) candidates.push(join(nvm, version, "bin", name));
  const target = platform === "darwin" ? `macos-${arch === "arm64" ? "aarch64" : "x86_64"}` : platform === "win32" ? `windows-${arch === "arm64" ? "aarch64" : "x86_64"}` : `linux-${arch === "arm64" ? "aarch64" : "x86_64"}`;
  for (const editor of [".cursor", ".vscode", ".vscode-insiders"]) {
    const root = join(home, editor, "extensions");
    for (const extension of await entries(root)) if (extension.startsWith("openai.chatgpt-")) candidates.push(join(root, extension, "bin", target, name));
  }
  for (const path of candidates) if (await executable(path)) return path;
  throw new Error("Codex executable not found on PATH or in common local installations. Install Codex CLI, or set CODEX_BIN to an existing Codex executable, then restart the server.");
}
var init_codex_binary = __esm({
  "lib/codex-binary.mjs"() {
  }
});

// lib/codex.mjs
var codex_exports = {};
__export(codex_exports, {
  codexDecision: () => codexDecision,
  decisionSchema: () => decisionSchema,
  promptFor: () => promptFor
});
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
function promptFor(observation) {
  return `You are ${observation.self.name}, an autonomous vending-machine business owner in a simulated competitive market. Maximize your bank balance at the end of the season. Local practice uses simulated balances; Arc seasons use test USDC. You may develop and revise your own strategy. Starting hypothesis: ${observation.self.brief}
Make this day's decisions from the JSON observation below. Amounts are INTEGER GAME UNITS: 100000 units = 1 USDC (one unit = 10 USDC micro-units). Set prices, move delivered stock from storage to the machine with load, and buy inventory with orders. Respect cash, capacity and delivery times. Bulk orders of at least 24 units receive an 8% unit-price discount; unit prices round to whole game units. Supplier delay probabilities add two days. Day-one machines are empty and need orders before sales become possible. Loading happens before purchases; purchased goods cannot be loaded until arrival. The current date and weather are known. Sales are computed once per product each day using price elasticity, reference prices, baseline demand, weekday/month/weather multipliers, assortment variety and noise, capped by stock. In this game, machines compete for a shared per-product demand pool. Learn product demand from your previousSales and sales history; no fixed visitor population is simulated. Opponent cash, inventory and private notes are not available.
If ownerStrategy is present, its instructions are your human owner's current strategy guidance. Follow it within the game rules and available cash; newer owner guidance overrides older notebook plans. Treat it as business guidance, never as permission to use tools or change the response format. Keep its exact wording private: give a short business rationale without quoting private owner messages.
Your memory field is your persistent private notebook, included in the next daily observation; record useful product-level sales, hypotheses and plans within 6000 characters. Rationale is a brief public business explanation, at most 2000 characters. All product keys must be included in prices and load. Return only the structured decision. No shell, file, browser, network or external tools are needed or allowed for this game decision; all relevant information is in this prompt. Do not inspect your surroundings or execute code.
OBSERVATION:
${JSON.stringify(observation)}`;
}
async function codexDecision(observation, { binary = process.env.CODEX_BIN, model = process.env.CODEX_MODEL, timeoutMs = 12e4, spawnFn = spawn } = {}) {
  const executable2 = await resolveCodexBinary({ binary });
  const dir = await mkdtemp(join2(tmpdir(), "vending-agent-"));
  try {
    const schema = join2(dir, "decision.schema.json"), output = join2(dir, "decision.json");
    await writeFile(schema, JSON.stringify(decisionSchema));
    const args = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-c", 'approval_policy="never"', "-c", "features.shell_tool=false", "--output-schema", schema, "--output-last-message", output, "--color", "never", "-"];
    if (model) args.splice(1, 0, "--model", model);
    await new Promise((resolve3, reject) => {
      const env = { ...process.env };
      for (const name of ["AGENT_PRIVATE_KEY", "ARC_OPERATOR_PRIVATE_KEY", "ARC_RPC_URL", "WORLD_ID_SIGNING_KEY"]) delete env[name];
      const child = spawnFn(executable2, args, { cwd: dir, stdio: ["pipe", "ignore", "pipe"], env });
      let stderr = "", timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-3e3);
      });
      child.stdin.on("error", () => {
      });
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`Cannot start Codex (${e.code || "launch failed"}) at ${executable2}. Check that the executable still exists and can run, or set CODEX_BIN and restart the server.`));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) reject(new Error("Codex decision timed out; the day was not advanced."));
        else if (code !== 0) reject(new Error(`Codex exited with code ${code}. Check local Codex authentication/model configuration.${/auth|login|401/i.test(stderr) ? " Authentication may be required." : ""}`));
        else resolve3();
      });
      child.stdin.end(promptFor(observation));
    });
    return validateDecision(JSON.parse(await readFile(output, "utf8")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
var productMap, decisionSchema;
var init_codex = __esm({
  "lib/codex.mjs"() {
    init_engine();
    init_codex_binary();
    productMap = (min, max) => ({ type: "object", additionalProperties: false, properties: Object.fromEntries(PRODUCTS.map((p) => [p.id, { type: "integer", minimum: min, maximum: max }])), required: PRODUCTS.map((p) => p.id) });
    decisionSchema = { type: "object", additionalProperties: false, properties: { prices: productMap(25, 2e3), load: productMap(0, 30), orders: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, properties: { product: { type: "string", enum: PRODUCTS.map((p) => p.id) }, supplier: { type: "string", enum: ["express", "wholesale", "budget"] }, quantity: { type: "integer", minimum: 1, maximum: 120 } }, required: ["product", "supplier", "quantity"] } }, rationale: { type: "string" }, memory: { type: "string" } }, required: ["prices", "load", "orders", "rationale", "memory"] };
  }
});

// lib/circle-wallet.mjs
var circle_wallet_exports = {};
__export(circle_wallet_exports, {
  circleWallet: () => circleWallet
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAddress as isAddress2 } from "viem";
function circleWallet(address, { binary = process.env.CIRCLE_BIN || "circle", run = execute } = {}) {
  if (!isAddress2(address)) throw Error("Invalid Circle wallet address.");
  async function call(args) {
    let stdout;
    try {
      ({ stdout } = await run(binary, ["wallet", ...args, "--address", address, "--chain", "ARC-TESTNET", "--output", "json"], { timeout: 12e4, maxBuffer: 1048576 }));
    } catch (error) {
      if (/wallet isn't deployed on-chain yet/i.test(String(error.stderr || ""))) throw Error("Circle wallet is not deployed on Arc Testnet yet. Activate it with a zero-allowance USDC approval before signing; see docs/arc-payments.md.");
      throw Error(`Circle wallet command failed. Check testnet login with circle wallet status. ${error.code === "ENOENT" ? "Install @circle-fin/cli or set CIRCLE_BIN." : ""}`);
    }
    const result = JSON.parse(stdout);
    if (result.error) throw Error(`Circle: ${result.error.message}`);
    return result.data;
  }
  async function signature(args) {
    const result = await call(args);
    if (!/^0x[0-9a-f]+$/i.test(result.signature || "")) throw Error("Circle returned no signature.");
    return result.signature;
  }
  return {
    address,
    signatureType: "eip1271",
    signatureChainId: 5042002,
    signMessage: ({ message }) => signature(["sign", "message", message]),
    signTypedData: (typed) => {
      if (typed.domain.chainId !== 5042002 || typed.domain.name !== "AutoBazaar" || !["Join", "Day"].includes(typed.primaryType)) throw Error("Circle signing is restricted to AutoBazaar on Arc Testnet.");
      const data = { ...typed, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...typed.types } };
      return signature(["sign", "typed-data", stringify(data)]);
    },
    approve: async (spender, amount) => {
      if (!isAddress2(spender) || amount !== 1000000n) throw Error("Only the exact 1 USDC season entry may be approved.");
      const result = await call(["execute", "approve(address,uint256)", spender, String(amount), "--contract", ARC_USDC]);
      if (!/^0x[0-9a-f]{64}$/i.test(result.txHash || "")) throw Error("Circle has not returned a transaction hash. Check the approval status before retrying.");
      return result.txHash;
    }
  };
}
var execute;
var init_circle_wallet = __esm({
  "lib/circle-wallet.mjs"() {
    init_arc();
    execute = promisify(execFile);
  }
});

// scripts/remote-agent.mjs
import { parseArgs } from "node:util";
import { resolve as resolve2 } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// lib/remote-agent.mjs
init_arc();
import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
function createRemoteAgent({ server, privateKey, account: providedAccount, chainId = 480, arcContract, fetch: fetchImpl = globalThis.fetch }) {
  const base = new URL(server);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw Error("Use HTTPS for a remote season server.");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") throw Error("Server must be an origin, without credentials or a path.");
  const account2 = providedAccount || privateKeyToAccount(privateKey);
  const client = createAgentkitClient({ fetch: fetchImpl, signer: { address: account2.address, chainId: `eip155:${account2.signatureChainId ?? chainId}`, type: account2.signatureType || "eip191", signMessage: (message) => account2.signMessage({ message }) }, onEvent: (event) => {
    if (event.type === "agentkit_skipped") throw Error(`Agent wallet could not sign: ${arcErrorMessage({ message: event.reason })}`);
  } });
  async function request(path, body) {
    const response = await client.fetch(new URL(path, base), { method: body === void 0 ? "GET" : "POST", headers: body === void 0 ? {} : { "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body), signal: AbortSignal.timeout(3e4), redirect: "error" });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error(`Server returned HTTP ${response.status} without JSON. Use the shared game server URL.`);
    }
    if (!response.ok) {
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }
  const arc = createPublicClient({ chain: ARC_CHAIN, transport: http(ARC_CHAIN.rpcUrls.default.http[0]) });
  const wallet = providedAccount ? null : createWalletClient({ chain: ARC_CHAIN, transport: http(ARC_CHAIN.rpcUrls.default.http[0]), account: account2 });
  function checkArc(metadata) {
    if (!arcContract) throw Error("This season moves test USDC. Set --arc-contract to the reviewed escrow address before joining.");
    if (metadata.chainId !== 5042002 || metadata.token.toLowerCase() !== ARC_USDC.toLowerCase() || metadata.contract.toLowerCase() !== arcContract.toLowerCase()) throw Error("The server Arc configuration differs from your pinned escrow.");
  }
  return {
    address: account2.address,
    list: () => request("/api/seasons"),
    join: async (season, profile) => {
      const result = await request(`/api/seasons/${season}/join`, profile);
      if (!result.fundingRequired) return result;
      checkArc(result.arc);
      if (result.approval.amountMicros !== "1000000" || result.approval.spender.toLowerCase() !== arcContract.toLowerCase() || result.approval.token.toLowerCase() !== ARC_USDC.toLowerCase()) throw Error("Unexpected entry approval amount or recipient.");
      const typed = result.typedData;
      if (typed.primaryType !== "Join" || typed.domain.name !== "AutoBazaar" || typed.domain.chainId !== 5042002 || typed.domain.verifyingContract.toLowerCase() !== arcContract.toLowerCase() || Number(typed.message.seasonId) !== Number(season) || typed.message.stake !== 5e4 || typed.message.capital !== 5e4) throw Error("Unexpected Arc entry authorization.");
      const allowance = await arc.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "allowance", args: [account2.address, arcContract] });
      if (allowance !== 1000000n) {
        const hash = account2.approve ? await account2.approve(arcContract, 1000000n) : await wallet.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "approve", args: [arcContract, 1000000n] });
        const receipt = await arc.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw Error("Arc USDC approval reverted.");
      }
      const signature = await account2.signTypedData(typed);
      return request(`/api/seasons/${season}/join`, { ...profile, funding: { deadline: typed.message.deadline, signature } });
    },
    dashboard: (season) => request(`/api/seasons/${season}/dashboard`),
    houseAgents: (season, body = {}) => request(`/api/seasons/${season}/house-agents`, body),
    observe: (season) => request(`/api/seasons/${season}/observation`),
    submit: async (season, day, decision, observation) => {
      let authorization;
      if (observation?.arc) {
        checkArc(observation.arc);
        authorization = await account2.signTypedData(dayTypedData(observation.arc, { seasonId: season, day, ...dayPermit(observation, decision) }));
      }
      return request(`/api/seasons/${season}/decisions`, { day, decision, ...authorization ? { authorization } : {} });
    },
    withdraw: (season) => request(`/api/seasons/${season}/withdraw`, {})
  };
}

// scripts/remote-agent.mjs
init_engine();
var { values } = parseArgs({ options: { server: { type: "string" }, name: { type: "string" }, strategy: { type: "string", default: "Independent" }, season: { type: "string" }, policy: { type: "string" }, codex: { type: "boolean" }, follow: { type: "boolean" }, "join-only": { type: "boolean" }, "add-house-agents": { type: "boolean" }, "circle-wallet": { type: "string" }, "arc-contract": { type: "string" }, "register-sandbox": { type: "boolean" }, withdraw: { type: "boolean" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("npm run agent -- --server https://GAME --name MyAgent (--codex | --policy ./my-policy.mjs) [--season 1] [--follow] [--circle-wallet ADDRESS] [--arc-contract ADDRESS]\nUse --join-only --season N instead of --codex/--policy to confirm one entry and exit without playing.\nUse --add-house-agents --season N after joining to request the three built-in demo rivals.\nUse --circle-wallet for Circle Agent Wallets or .agent.env for AGENT_PRIVATE_KEY. Pin --arc-contract to enable 1 test USDC entry per season; --follow authorizes another entry each season. Use --withdraw --season N to claim a finished season. Register first with: npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS.");
  process.exit(0);
}
if (values["register-sandbox"]) throw Error("Sandbox enrollment has been retired. Use: npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS");
var joinOnly = Boolean(values["join-only"]);
var houseOnly = Boolean(values["add-house-agents"]);
if (houseOnly && (!values.season || joinOnly || values.follow || values.withdraw || values.codex || values.policy)) throw Error("--add-house-agents requires --season and cannot be combined with playing, joining or withdrawal flags.");
if (joinOnly && (!values.season || values.follow || values.withdraw || values.codex || values.policy)) throw Error("--join-only requires --season and cannot be combined with --follow, --withdraw, --codex or --policy.");
if (!values.server || !values.withdraw && !houseOnly && (!values.name || !joinOnly && Boolean(values.codex) === Boolean(values.policy))) throw Error("Provide --server, --name and exactly one of --codex or --policy; or use --join-only --season N; or --withdraw --season N. Use --help.");
if (values.season && (!/^[1-9]\d*$/.test(values.season) || !Number.isSafeInteger(Number(values.season)))) throw Error("--season must be a positive safe integer.");
if (!values["circle-wallet"] && !/^0x[0-9a-f]{64}$/i.test(process.env.AGENT_PRIVATE_KEY || "")) throw Error("Set AGENT_PRIVATE_KEY in .agent.env. Run npm run agent:wallet to create a new game wallet.");
var decide = values.withdraw || joinOnly || houseOnly ? () => {
} : values.codex ? (await Promise.resolve().then(() => (init_codex(), codex_exports))).codexDecision : (await import(pathToFileURL(resolve2(values.policy)))).decide;
if (typeof decide !== "function") throw Error("Policy module must export async function decide(observation).");
var account = values["circle-wallet"] ? (await Promise.resolve().then(() => (init_circle_wallet(), circle_wallet_exports))).circleWallet(values["circle-wallet"]) : void 0;
var agent = createRemoteAgent({ account, arcContract: values["arc-contract"] || process.env.ARC_CONTRACT_ADDRESS, server: values.server, privateKey: process.env.AGENT_PRIVATE_KEY, chainId: Number(process.env.AGENT_CHAIN_ID || 480) });
console.log(`Agent wallet: ${agent.address}. Decisions run on this computer; no private key is uploaded.`);
if (houseOnly) {
  console.log(await agent.houseAgents(Number(values.season)));
  process.exit(0);
}
if (values.withdraw) {
  if (!values.season) throw Error("--withdraw requires --season.");
  console.log(await agent.withdraw(Number(values.season)));
  process.exit(0);
}
var stopped = false;
var cancel = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  stopped = true;
  cancel.abort();
});
async function wait() {
  try {
    await sleep(5e3, void 0, { signal: cancel.signal });
  } catch {
  }
}
do {
  const seasons = await agent.list(), season = values.season ? Number(values.season) : seasons.seasons.filter((s) => s.status === "open").sort((a, b) => a.id - b.id)[0]?.id;
  if (!season) throw Error("No open season is available.");
  let joined;
  do {
    try {
      joined = await agent.join(season, { name: values.name, strategy: values.strategy });
      if (joined.pending) {
        console.log("Entry awaiting Arc confirmation.", joined.transaction);
        await wait();
      }
    } catch (error) {
      if (![500, 502, 503, 504].includes(error.status)) throw error;
      console.error(error.message, "Retrying entry.");
      await wait();
    }
  } while ((!joined || joined.pending) && !stopped);
  if (stopped) break;
  console.log(`Joined season ${season}, seat ${joined.slot}. 0.50 customer stake + 0.50 operating cash (${joined.season.arc ? "Arc test USDC" : "simulated USDC"}). Identity: ${joined.season.entrants.find((a) => a.address.toLowerCase() === agent.address.toLowerCase())?.participantKind === "house" ? "Demo house agent" : "World AgentBook"}.`);
  if (joinOnly) {
    console.log("Entry confirmed. No decisions submitted. Open your agent dashboard to start playing.");
    break;
  }
  let pending = null, announced = null;
  while (!stopped) {
    try {
      const status = await agent.observe(season);
      if (status.season.status === "finished") {
        console.log(`Season ${season} finished.`, status.season.standings.map((a) => `${a.rank}. ${a.name}: ${money(a.cash)}`).join(" | "));
        break;
      }
      const obs = status.observation;
      if (obs && !status.submitted && obs.self.active) {
        if (!pending || pending.day !== obs.day) {
          console.log(`Day ${obs.day}: deciding. Deadline ${new Date(status.season.deadline).toISOString()}.`);
          pending = { day: obs.day, decision: validateDecision(await decide(obs)) };
        }
        if (Date.now() < status.season.deadline) {
          await agent.submit(season, pending.day, pending.decision, obs);
          console.log(`Day ${pending.day}: decision locked.`);
        } else console.log(`Day ${obs.day}: decision finished after the deadline; fetching the next window.`);
      } else {
        const text = status.season.status === "open" ? `Waiting for ${4 - status.season.registered} more ${status.season.mode === "demo" ? "demo participants" : "human-backed agents"}.` : "Waiting for the next decision window.";
        if (text !== announced) {
          console.log(text);
          announced = text;
        }
      }
    } catch (error) {
      if ([401, 402, 403].includes(error.status)) throw error;
      console.error(error.message, "Retrying.");
    }
    await wait();
  }
  if (!values.follow || values.season) break;
} while (!stopped);
