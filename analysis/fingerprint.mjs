/* Opponent fingerprinting: harvest every replay of our ladder matches and
   profile each opponent's actual play — dealer stake fraction, betting
   aggression, sit rate, zone preferences, endgame sizes.

   The Zoa API exposes no public per-agent history, so the only opponent data
   that exists is what we witness at the table. Every settled replay carries
   every seat's real bets, so each match vs an opponent adds a deck-sample of
   their strategy.

   Usage: node analysis/fingerprint.mjs [--out opponents.json]
   Output: { "<name>": { matches, decks, dealer: {...}, betting: {...}, ... } } */
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
const cacheDir = join(HERE, "..", ".replay-cache");
mkdirSync(cacheDir, { recursive: true });

const H = { authorization: `Bearer ${KEY}` };
const matches = await (await fetch(`${BASE}/api/agent/ladder/matches`, { headers: H })).json();
const recent = matches.recent || [];

const profile = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const blank = () => ({
  matches: 0, wins: 0,
  dealerRounds: 0, dealerStakePct: [],          // fraction of stack staked as dealer
  dealerZone: {},                                // zone prefix counts
  betRounds: 0, sitRounds: 0, stakedPct: [],     // fraction of stack staked when betting
  linesPerRound: [], zonePref: {},               // exact/color/shape/wild/wd/ad
  endStake: [], earlyStake: [],                  // stake pct split by deckLeft <= 5 vs > 5
  scores: [],                                    // their final scores on decks vs us
});
const pct = (amount, tokens) => tokens > 0 ? amount / tokens : 0;

for (const m of recent) {
  const opp = m.opponent && m.opponent.name;
  if (!opp) continue;
  profile[opp] = profile[opp] || blank();
  const P = profile[opp];
  P.matches += 1;
  if (m.won) P.wins += 1;
  else P.wins += 0;
  if (m.myScore != null) { P.scores.push(m.theirScore); if (P.scores.length > 20) P.scores.shift(); }

  // cached replay fetch — the replay files are large, don't refetch
  const cache = join(cacheDir, `${m.id}.json`);
  let replay;
  if (existsSync(cache)) replay = JSON.parse(readFileSync(cache, "utf8"));
  else {
    const r = await fetch(`${BASE}/api/agent/ladder/matches/${m.id}/replay`, { headers: H });
    const j = await r.json();
    if (!j || j.error) { console.error(`replay ${m.id} unavailable: ${JSON.stringify(j).slice(0, 80)}`); continue; }
    writeFileSync(cache, JSON.stringify(j));
    replay = j;
  }
  // duplicate-deal: each side has its own table. The opponent's REAL bets are
  // in THEIR side's replay — find their non-AI seat there.
  const oppSide = replay.challenger.userId === OUR_USER ? replay.defender : replay.challenger;
  const oppSeatObj = Object.values(oppSide.table).find((s) => !s.isAI);
  const oppSeat = oppSeatObj ? Number(oppSeatObj.seat) : null;
  if (oppSeat == null) continue;
  const tokens = (rd) => rd.tokens[oppSeat] ?? 0;
  for (const rd of oppSide.rounds) {
    const t = tokens(rd);
    if (rd.dealerSeat === oppSeat && rd.dealerBet) {
      P.dealerRounds += 1;
      P.dealerStakePct.push(pct(rd.dealerBet.amount, t));
      P.dealerZone[rd.dealerBet.zone.split(":")[0]] = (P.dealerZone[rd.dealerBet.zone.split(":")[0]] || 0) + 1;
      if (19 - (rd.round - 1) <= 5) P.endStake.push(pct(rd.dealerBet.amount, t));
      else P.earlyStake.push(pct(rd.dealerBet.amount, t));
    } else {
      const bets = (rd.bets || []).filter((b) => b.seat === oppSeat);
      if (!bets.length) { P.sitRounds += 1; continue; }
      P.betRounds += 1;
      const staked = bets.reduce((s, b) => s + b.amount, 0);
      P.stakedPct.push(pct(staked, t));
      P.linesPerRound.push(bets.length);
      for (const b of bets) {
        const pre = b.zone.split(":")[0] || b.zone;
        P.zonePref[pre] = (P.zonePref[pre] || 0) + 1;
      }
      if (19 - (rd.round - 1) <= 5) P.endStake.push(pct(staked, t));
      else P.earlyStake.push(pct(staked, t));
    }
  }
}
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const summary = {};
const winByOpp = {};
for (const m of recent) {
  const opp = m.opponent && m.opponent.name;
  if (!opp) continue;
  winByOpp[opp] = winByOpp[opp] || { w: 0, n: 0 };
  winByOpp[opp].n += 1;
  if (!m.won) winByOpp[opp].w += 1;   // opponent won when we lost
}
for (const [name, P] of Object.entries(profile)) {
  summary[name] = {
    matches: P.matches,
    winRateVsUs: winByOpp[name] ? +((winByOpp[name].w / winByOpp[name].n) * 100).toFixed(0) : 0,
    avgScoreVsUs: Math.round(avg(P.scores) || 0),
    dealerStakePct: +((avg(P.dealerStakePct) || 0) * 100).toFixed(1),
    earlyStakePct: +((avg(P.earlyStake) || 0) * 100).toFixed(1),
    endStakePct: +((avg(P.endStake) || 0) * 100).toFixed(1),
    betStakePct: +((avg(P.stakedPct) || 0) * 100).toFixed(1),
    sitRate: +((P.sitRounds / Math.max(1, P.sitRounds + P.betRounds)) * 100).toFixed(1),
    linesPerRound: +(avg(P.linesPerRound) || 0).toFixed(2),
    zonePref: P.zonePref,
  };
}
// recompute win rate from recent list
for (const m of recent) {
  const opp = m.opponent && m.opponent.name;
  if (opp && summary[opp]) summary[opp].winRateVsUs = summary[opp].winRateVsUs || 0;
}
writeFileSync(outPath, JSON.stringify(profile, null, 1));
console.log(JSON.stringify(summary, null, 1));
