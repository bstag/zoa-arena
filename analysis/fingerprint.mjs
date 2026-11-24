/* Opponent fingerprinting + drift detection.
   Harvests every replay of our ladder matches and profiles each opponent's
   actual play. Duplicate-deal caveat: each side's table is recorded
   separately — the opponent's real bets live in THEIR side of the replay.

   Storage model (opponents.json):
     { "<name>": {
         samples: { "<matchId>": {at, won, score, dealerStakes[], betStakes[],
                    sitRounds, betRounds, lines[], zones{}, endStakes[],
                    earlyStakes[]} },
         summary: { matches, class, drift, ...rolling aggregates }
       } }

   Drift rule: with >= MIN_FOR_DRIFT samples, compare dealer/bet stake and
   sit-rate of the older half vs the newer half; a shift beyond threshold
   flags a behavior change (reported in summary.drift and on stdout).
   Pruning: keep at most KEEP samples per opponent, newest kept.
   Adaptation rule: class labels are trusted only at >= 3 samples; below
   that the strategy layer uses the fleet default schedule.

   Usage: node analysis/fingerprint.mjs [--out opponents.json] */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(HERE, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const KEY = process.env.IN2IT_API_KEY;
const OUR_USER = 395;
const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(HERE, "..", "opponents.json");
const KEEP = 10;                    // prune cap per opponent (newest kept)
const DRIFT_PCT = 15;               // stake-field drift threshold (points)
const DRIFT_SIT = 10;               // sit-rate drift threshold (points)
const MIN_FOR_DRIFT = 4;            // samples before drift is meaningful
const MIN_FOR_CLASS = 3;            // samples before a class label is trusted
const cacheDir = join(HERE, "..", ".replay-cache");
mkdirSync(cacheDir, { recursive: true });

const H = { authorization: `Bearer ${KEY}` };
const matches = await (await fetch(`${BASE}/api/agent/ladder/matches`, { headers: H })).json();
const recent = matches.recent || [];

const store = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
// migrate v1 profiles (no samples key)
for (const k of Object.keys(store)) if (!store[k].samples) store[k] = { samples: {} };
const pct = (amount, tokens) => tokens > 0 ? amount / tokens : 0;

for (const m of recent) {
  const opp = m.opponent && m.opponent.name;
  if (!opp) continue;
  store[opp] = store[opp] || { samples: {} };
  const S = store[opp].samples;
  if (S[m.id]) continue;                       // already harvested

  const cache = join(cacheDir, `${m.id}.json`);
  let replay;
  if (existsSync(cache)) replay = JSON.parse(readFileSync(cache, "utf8"));
  else {
    const r = await fetch(`${BASE}/api/agent/ladder/matches/${m.id}/replay`, { headers: H });
    const j = await r.json();
    if (!j || j.error) { console.error(`replay ${m.id} unavailable`); continue; }
    writeFileSync(cache, JSON.stringify(j));
    replay = j;
  }
  // duplicate-deal: the opponent's REAL bets are in THEIR side of the replay
  const oppSide = replay.challenger.userId === OUR_USER ? replay.defender : replay.challenger;
  const oppSeatObj = Object.values(oppSide.table).find((s) => !s.isAI);
  const oppSeat = oppSeatObj ? Number(oppSeatObj.seat) : null;
  if (oppSeat == null) continue;

  const sample = { matchId: m.id, at: m.playedAt || new Date().toISOString(),
    won: !m.won, score: m.theirScore,
    dealerRounds: 0, betRounds: 0, sitRounds: 0,
    dealerStakes: [], betStakes: [], endStakes: [], earlyStakes: [],
    lines: [], zones: {} };
  for (const rd of oppSide.rounds) {
    const t = rd.tokens[oppSeat] ?? 0;
    if (rd.dealerSeat === oppSeat && rd.dealerBet) {
      sample.dealerRounds += 1;
      sample.dealerStakes.push(pct(rd.dealerBet.amount, t));
      const bin = 19 - (rd.round - 1) <= 5 ? sample.endStakes : sample.earlyStakes;
      bin.push(pct(rd.dealerBet.amount, t));
    } else {
      const bets = (rd.bets || []).filter((b) => b.seat === oppSeat);
      if (!bets.length) { sample.sitRounds += 1; continue; }
      sample.betRounds += 1;
      const staked = bets.reduce((s, b) => s + b.amount, 0);
      sample.betStakes.push(pct(staked, t));
      sample.lines.push(bets.length);
      const bin = 19 - (rd.round - 1) <= 5 ? sample.endStakes : sample.earlyStakes;
      bin.push(pct(staked, t));
      for (const b of bets) {
        const pre = b.zone.split(":")[0] || b.zone;
        sample.zones[pre] = (sample.zones[pre] || 0) + 1;
      }
    }
  }
  S[m.id] = sample;
}

// summarize + drift + prune
const summary = {};
const drifted = [];
for (const [name, entry] of Object.entries(store)) {
  const all = Object.values(entry.samples).sort((a, b) => (a.at < b.at ? -1 : 1));
  const kept = all.slice(-KEEP);                       // prune: newest KEEP kept
  for (const old of all.slice(0, -KEEP)) delete entry.samples[old.matchId];

  const agg = (samples) => {
    const d = [], b = [], e = [], ea = [], z = {};
    let sit = 0, rounds = 0, betCount = 0;
    for (const s of samples) {
      d.push(...s.dealerStakes); b.push(...s.betStakes);
      e.push(...s.endStakes); ea.push(...s.earlyStakes);
      sit += s.sitRounds; rounds += s.sitRounds + s.betRounds; betCount += s.betRounds;
      for (const [k, v] of Object.entries(s.zones)) z[k] = (z[k] || 0) + v;
    }
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    return { dealerPct: avg(d) * 100, betPct: avg(b) * 100, endPct: avg(e) * 100, earlyPct: avg(ea) * 100,
      sitRate: rounds ? (sit / rounds) * 100 : 0,
      linesPerRound: rounds ? betCount / rounds : 0, zones: z };
  };
  const sum = agg(kept);
  const n = kept.length;
  const theirWins = kept.filter((s) => s.won).length;
  const out = { matches: n, theirWinRateVsUs: n ? Math.round((theirWins / n) * 100) : 0,
    avgScoreVsUs: Math.round(kept.reduce((s, x) => s + (x.score || 0), 0) / Math.max(1, n)),
    dealerStakePct: +sum.dealerPct.toFixed(1), betStakePct: +sum.betPct.toFixed(1),
    earlyStakePct: +sum.earlyPct.toFixed(1), endStakePct: +sum.endPct.toFixed(1),
    sitRate: +sum.sitRate.toFixed(1), linesPerRound: +sum.linesPerRound.toFixed(2),
    zonePref: sum.zones, class: null, drift: null };

  if (n >= MIN_FOR_CLASS) {
    out.class = sum.betPct >= 70 ? "overbetter"
      : sum.betPct >= 30 && sum.sitRate < 25 ? "steady-presser"
      : sum.sitRate >= 25 ? "wait-then-fire"
      : "cautious";
  }
  if (n >= MIN_FOR_DRIFT) {
    const half = Math.floor(n / 2);
    const o = agg(kept.slice(0, half)), w = agg(kept.slice(half));
    for (const [field, oldV, newV, thr] of [
      ["dealerStakePct", o.dealerPct, w.dealerPct, DRIFT_PCT],
      ["betStakePct", o.betPct, w.betPct, DRIFT_PCT],
      ["sitRate", o.sitRate, w.sitRate, DRIFT_SIT],
    ]) {
      if (Math.abs(newV - oldV) >= thr) {
        out.drift = { field, oldPct: +oldV.toFixed(1), newPct: +newV.toFixed(1) };
        drifted.push(`${name}: ${field} ${oldV.toFixed(0)}% -> ${newV.toFixed(0)}% (older half vs newer half)`);
        break;
      }
    }
  }
  entry.summary = out;
  summary[name] = out;
}
writeFileSync(outPath, JSON.stringify(store, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (drifted.length) console.log("DRIFT DETECTED:\n" + drifted.join("\n"));
