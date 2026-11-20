/* Skills Ladder A/B: play N games against a named house agent, alternating
   strategies, and report the distributions. No ladder stakes; burns the
   shared 96-games/day cap.

   node analysis/duel.mjs --agent pip --games 8 \
        --a ./variants/arb.mjs --b ./variants/pokka-style.mjs
   (odd games play A, even games play B — alternating so deck luck spreads) */
import io from "socket.io-client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const KEY = process.env.IN2IT_API_KEY;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const AGENT = opt("agent", "pip");
const GAMES = Number(opt("games", 8));
const STRAT_A = opt("a", "./variants/arb.mjs");
const STRAT_B = opt("b", "./variants/pokka-style.mjs");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const A = await import(new URL(STRAT_A, `file://${process.cwd()}/`).href);
const B = await import(new URL(STRAT_B, `file://${process.cwd()}/`).href);

function playGame(strat, label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { apiKey: KEY }, transports: ["websocket"] });
    const acted = { dealer: -1, bet: -1 };
    let done = false;
    socket.on("connect", () => socket.emit("lobby:challengeAgent", { agent: AGENT, size: 4 }));
    socket.on("connect_error", (e) => reject(new Error(`connect_error: ${e.message}`)));
    socket.on("game:error", (e) => { socket.disconnect(); reject(new Error(`${e.code}: ${e.message}`)); });
    socket.on("game:state", (g) => {
      if (g.you == null) return;
      const me = g.players[g.you];
      if (g.phase === "dealerBet" && g.dealerSeat === g.you && !g.dealerBet && acted.dealer !== g.round) {
        acted.dealer = g.round;
        const pick = strat.dealerPick(g);
        if (pick.amount > 0) socket.emit("game:dealerBet", pick);
      }
      if (g.phase === "betting" && g.dealerSeat !== g.you && acted.bet !== g.round) {
        acted.bet = g.round;
        for (const b of strat.bets(g)) socket.emit("game:bet", b);
      }
      if (g.phase === "gameover" && !done) {
        done = true;
        const ranked = [...g.players].sort((a, b) => b.tokens - a.tokens);
        const place = ranked.findIndex((p) => p.seat === g.you) + 1;
        log(`[${label}] game over: ${me.tokens} tokens (${place} of ${g.players.length})`);
        socket.emit("game:leave");
        setTimeout(() => { socket.disconnect(); resolve({ tokens: me.tokens, place }); }, 500);
      }
    });
  });
}

const results = { A: [], B: [] };
for (let i = 0; i < GAMES; i++) {
  const isA = i % 2 === 0;
  const strat = isA ? A : B, label = `g${i + 1} ${isA ? "A(arb)" : "B(pokka)"}`;
  log(`--- game ${i + 1}/${GAMES}: ${label} vs ${AGENT}`);
  let r;
  try { r = await playGame(strat, label); }
  catch (e) {
    log(`game failed: ${e.message}; retrying once in 60s`);
    await new Promise((res) => setTimeout(res, 60_000));
    try { r = await playGame(strat, label); } catch (e2) { log(`failed again: ${e2.message}`); continue; }
  }
  results[isA ? "A" : "B"].push(r.tokens);
}
const stats = (arr) => arr.length ? `n=${arr.length} median=${[...arr].sort((x, y) => x - y)[Math.floor(arr.length / 2)]} mean=${Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)} max=${Math.max(...arr)} : ${arr.join(",")}` : "none";
console.log(`\n=== SKILLS A/B vs ${AGENT} ===`);
console.log(`A ${STRAT_A}: ${stats(results.A)}`);
console.log(`B ${STRAT_B}: ${stats(results.B)}`);
