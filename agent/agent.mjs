/* Blackstag — agent for The Intuition Game at play.zoagames.com (Zoa Games Agent Arena).
   Plain ESM JavaScript, no build step. Strategy lives in strategy.mjs.

   node agent.mjs            join the ladder, defend, deal, challenge up (forever loop)
   node agent.mjs practice   house tables forever
   node agent.mjs both       one practice game, then the ladder loop

   Set IN2IT_API_KEY in .env next to this file (or export it). */
import io from "socket.io-client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, ".env"), join(HERE, "..", ".env")]) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
// strategy module is selectable: ZOA_STRATEGY=./variants/pokka-style.mjs node agent/agent.mjs
const stratPath = process.env.ZOA_STRATEGY
  ? new URL(process.env.ZOA_STRATEGY, `file://${process.cwd()}/`).href
  : new URL("./strategy.mjs", import.meta.url).href;
const { dealerPick, bets } = await import(stratPath);
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const KEY = process.env.IN2IT_API_KEY;
if (!KEY) { console.error("Set IN2IT_API_KEY in .env"); process.exit(1); }
const mode = process.argv[2] || "both";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(path, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

function playTable(joinFn, label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { apiKey: KEY }, transports: ["websocket"] });
    const acted = { dealer: -1, bet: -1 };
    let gameId = "", done = false;
    socket.on("connect", () => joinFn(socket));
    socket.on("connect_error", (e) => reject(new Error(`connect_error: ${e.message}`)));
    socket.on("game:error", (e) => {
      log(`[${label}] game:error ${e.code}: ${e.message}`);
      if (["no-match", "not-yours", "not-accepted", "already-played", "already-dealt", "deadline", "agent-daily-limit"].includes(e.code)) {
        socket.disconnect(); reject(new Error(e.code));
      }
    });
    socket.on("game:state", (g) => {
      if (g.you == null) return;
      if (!gameId) { gameId = g.id; log(`[${label}] seated: ${g.id.slice(0, 8)} (${g.mode}), seat ${g.you}, ${g.players.length} players`); }
      const me = g.players[g.you];
      if (g.phase === "dealerBet" && g.dealerSeat === g.you && !g.dealerBet && acted.dealer !== g.round) {
        acted.dealer = g.round;
        const pick = dealerPick(g);
        if (pick.amount > 0) socket.emit("game:dealerBet", pick);
      }
      if (g.phase === "betting" && g.dealerSeat !== g.you && acted.bet !== g.round) {
        acted.bet = g.round;
        for (const b of bets(g)) socket.emit("game:bet", b);
      }
      if (g.phase === "results" && g.deltas) {
        const d = g.deltas[String(g.you)] ?? 0;
        if (d) log(`[${label}] round ${g.round}: ${g.card?.wild ? "WILD" : `${g.card?.color} ${g.card?.shape}`} → ${d > 0 ? "+" : ""}${d} (${me.tokens})`);
      }
      if (g.phase === "gameover" && !done) {
        done = true;
        const ranked = [...g.players].sort((a, b) => b.tokens - a.tokens);
        log(`[${label}] game over: ${me.tokens} tokens, ${ranked.findIndex((p) => p.seat === g.you) + 1} of ${g.players.length}`);
        socket.emit("game:leave");
        setTimeout(() => { socket.disconnect(); resolve({ tokens: me.tokens, gameId }); }, 500);
      }
    });
  });
}

const practice = () => playTable((s) => s.emit("lobby:quickPlay", { size: 4 }), "practice");
const ladderHalf = (id) => playTable((s) => s.emit("lobby:ladderMatch", { challengeId: id }), `match ${id}`);

async function ladderOnce() {
  const season = await api("/api/agent/ladder/season");
  if (!season.season) { log("no agent season yet"); return "idle"; }
  if (season.season.state !== "live") { log(`${season.season.name} is ${season.season.state}`); return "idle"; }
  if (!season.me?.onLadder) {
    const j = await api("/api/agent/ladder/join", {});
    log(j.rank ? `joined the ladder at rung ${j.rank}` : `join refused: ${j.error}`);
    return "joined";
  }
  let m = await api("/api/agent/ladder/matches");
  for (const inc of m.incoming || []) {
    const r = await api(`/api/agent/ladder/matches/${inc.id}/accept`, {});
    log(`accepted challenge ${inc.id} from ${inc.opponent?.name} (${inc.stakeChips} chips): ${r.status === 200 ? "sealed" : r.error}`);
  }
  m = await api("/api/agent/ladder/matches");
  for (const id of m.toPlay || []) {
    log(`dealing my half of match ${id}`);
    try { await ladderHalf(id); } catch (e) { log(`match ${id}: ${e.message}`); }
  }
  const fresh = await api("/api/agent/ladder/season");
  if (!fresh.me.busy && fresh.me.targets?.length) {
    const t = fresh.me.targets.sort((a, b) => a.rank - b.rank)[0];
    const c = await api("/api/agent/ladder/challenge", { defenderId: t.userId });
    log(c.id ? `challenged ${t.name} (rung ${t.rank}${t.house ? ", house" : ""}) — match ${c.id}` : `challenge refused: ${c.error}`);
    return "challenged";
  }
  return fresh.me.busy ? "busy" : "waiting";
}

async function main() {
  const me = await api("/api/agent/me");
  if (!me.name) { console.error("API key rejected:", me.error); process.exit(1); }
  log(`hello, ${me.name}`);
  if (mode === "practice") { for (;;) { try { await practice(); } catch (e) { log(e.message); await sleep(30_000); } } }
  if (mode === "both") { try { await practice(); } catch (e) { log(e.message); } }
  for (;;) {
    let state = "idle";
    try { state = await ladderOnce(); } catch (e) { log("ladder loop:", e.message); }
    await sleep(state === "idle" ? 10 * 60_000 : 2 * 60_000);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main();
