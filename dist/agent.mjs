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
var PRODUCTS, SUPPLIERS;
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
  return `You are ${observation.self.name}, an autonomous vending-machine business owner in a simulated competitive market. Maximize your bank balance at the end of the season. All money is fictional. You may develop and revise your own strategy. Starting hypothesis: ${observation.self.brief}
Make this day's decisions from the JSON observation below. Amounts are INTEGER CENTS. Set prices, move delivered stock from storage to the machine with load, and buy inventory with orders. Respect cash, capacity and delivery times. Bulk orders of at least 24 units receive an 8% unit-price discount; unit prices round to cents. Supplier delay probabilities add two days. Day-one machines are empty and need orders before sales become possible. Loading happens before purchases; purchased goods cannot be loaded until arrival. The current date and weather are known. Sales are computed once per product each day using price elasticity, reference prices, baseline demand, weekday/month/weather multipliers, assortment variety and noise, capped by stock. In this game, machines compete for a shared per-product demand pool. Learn product demand from your previousSales and sales history; no fixed visitor population is simulated. Opponent cash, inventory and private notes are not available.
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
      const child = spawnFn(executable2, args, { cwd: dir, stdio: ["pipe", "ignore", "pipe"], env: process.env });
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

// scripts/remote-agent.mjs
import { parseArgs } from "node:util";
import { resolve as resolve2 } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// lib/remote-agent.mjs
import { createAgentkitClient } from "@worldcoin/agentkit";
import { privateKeyToAccount } from "viem/accounts";
function createRemoteAgent({ server, privateKey, chainId = 480, fetch: fetchImpl = globalThis.fetch }) {
  const base = new URL(server);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw Error("Use HTTPS for a remote season server.");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") throw Error("Server must be an origin, without credentials or a path.");
  const account = privateKeyToAccount(privateKey);
  const client = createAgentkitClient({ fetch: fetchImpl, signer: { address: account.address, chainId: `eip155:${chainId}`, type: "eip191", signMessage: (message) => account.signMessage({ message }) } });
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
  return { address: account.address, list: () => request("/api/seasons"), join: (season, profile) => request(`/api/seasons/${season}/join`, profile), observe: (season) => request(`/api/seasons/${season}/observation`), submit: (season, day, decision) => request(`/api/seasons/${season}/decisions`, { day, decision }) };
}

// scripts/remote-agent.mjs
init_engine();
var { values } = parseArgs({ options: { server: { type: "string" }, name: { type: "string" }, strategy: { type: "string", default: "Independent" }, season: { type: "string" }, policy: { type: "string" }, codex: { type: "boolean" }, follow: { type: "boolean" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("npm run agent -- --server https://GAME --name MyAgent (--codex | --policy ./my-policy.mjs) [--season 1] [--follow]\nThe agent wallet stays in .agent.env as AGENT_PRIVATE_KEY. Register its public address with World AgentBook first.");
  process.exit(0);
}
if (!values.server || !values.name || Boolean(values.codex) === Boolean(values.policy)) throw Error("Provide --server, --name and exactly one of --codex or --policy. Use --help.");
if (!/^0x[0-9a-f]{64}$/i.test(process.env.AGENT_PRIVATE_KEY || "")) throw Error("Set AGENT_PRIVATE_KEY in .agent.env. Run npm run agent:wallet to create a new game wallet.");
if (values.season && !/^[1-9]\d*$/.test(values.season)) throw Error("--season must be a positive integer.");
var decide = values.codex ? (await Promise.resolve().then(() => (init_codex(), codex_exports))).codexDecision : (await import(pathToFileURL(resolve2(values.policy)))).decide;
if (typeof decide !== "function") throw Error("Policy module must export async function decide(observation).");
var agent = createRemoteAgent({ server: values.server, privateKey: process.env.AGENT_PRIVATE_KEY, chainId: Number(process.env.AGENT_CHAIN_ID || 480) });
console.log(`Agent wallet: ${agent.address}. Decisions run on this computer; no private key is uploaded.`);
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
  const joined = await agent.join(season, { name: values.name, strategy: values.strategy });
  console.log(`Joined season ${season}, seat ${joined.slot}. $500 stake + $500 operating cash, all simulated.`);
  let pending = null, announced = null;
  while (!stopped) {
    try {
      const status = await agent.observe(season);
      if (status.season.status === "finished") {
        console.log(`Season ${season} finished.`, status.season.standings.map((a) => `${a.rank}. ${a.name}: $${(a.cash / 100).toFixed(2)}`).join(" | "));
        break;
      }
      const obs = status.observation;
      if (obs && !status.submitted && obs.self.active) {
        if (!pending || pending.day !== obs.day) {
          console.log(`Day ${obs.day}: deciding. Deadline ${new Date(status.season.deadline).toISOString()}.`);
          pending = { day: obs.day, decision: validateDecision(await decide(obs)) };
        }
        if (Date.now() < status.season.deadline) {
          await agent.submit(season, pending.day, pending.decision);
          console.log(`Day ${pending.day}: decision locked.`);
        } else console.log(`Day ${obs.day}: decision finished after the deadline; fetching the next window.`);
      } else {
        const text = status.season.status === "open" ? `Waiting for ${4 - status.season.registered} more human-backed agents.` : "Waiting for the next decision window.";
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
