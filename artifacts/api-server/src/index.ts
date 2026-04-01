import app, { initializeDatabase } from "./app.js";
import { logger } from "./lib/logger.js";
import { startCron, gracefulShutdown } from "./lib/cron.js";
import { sendTelegram, fmtPrice } from "./lib/telegram.js";
import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  try {
    await initializeDatabase();
    startCron();
  } catch (err) {
    logger.error({ err }, "Startup error (non-fatal)");
  }

  app.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

// === KEEP-ALIVE ULTRA ROBUSTE (toutes les 2 min + double ping) ===
setInterval(async () => {
  try {
    await fetch(`http://127.0.0.1:${port}/api/healthz`);
    await fetch(`http://127.0.0.1:${port}/api/healthz`);
    console.log(`[Keep-Alive] ✅ Double Ping OK @ ${new Date().toISOString()}`);
  } catch {
    console.warn("[Keep-Alive] Ping failed");
  }
}, 120_000);

// === RÉCAP HORAIRE 24h/24 ===
async function sendHourlyRecap() {
  try {
    const pending = await db.select().from(signalsTable)
      .where(eq(signalsTable.resolved, false))
      .orderBy(desc(signalsTable.created_at));

    if (pending.length === 0) {
      console.log("[HourlyRecap] Aucun trade ouvert — skip");
      return;
    }

    // Récupère les prix actuels pour afficher la variation
    const coinIds = [...new Set(pending.map(s => s.coin_id))];
    let priceMap: Record<string, number> = {};
    try {
      const ids = coinIds.join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, { usd: number }>;
        for (const id of coinIds) {
          if (data[id]?.usd) priceMap[id] = data[id].usd;
        }
      }
    } catch {
      // Prix indisponibles — on affiche quand même sans variation
    }

    const lines: string[] = [];
    for (const signal of pending) {
      const entry = parseFloat(signal.entry_price);
      const durationMs = Date.now() - new Date(signal.created_at).getTime();
      const totalMin = Math.floor(durationMs / 60000);
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      const durationStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

      const emoji = signal.direction === "LONG" ? "🟢" : "🔴";
      let currentStr = "—";
      let varStr = "";

      const currentPrice = priceMap[signal.coin_id] ?? null;
      if (currentPrice !== null) {
        currentStr = `$${fmtPrice(currentPrice)}`;
        const rawPct = ((currentPrice - entry) / entry) * 100;
        const directedPct = signal.direction === "LONG" ? rawPct : -rawPct;
        const sign = directedPct >= 0 ? "+" : "";
        varStr = `\n   Variation: ${sign}${directedPct.toFixed(2)}%`;
      }

      // TP et SL viennent directement des colonnes DB
      const tpStr = signal.tp_price ? `$${fmtPrice(signal.tp_price)}` : "—";
      const slStr = signal.sl_price ? `$${fmtPrice(signal.sl_price)}` : "—";

      lines.push(
        `${emoji} ${signal.symbol.toUpperCase()} ${signal.direction} — ouvert il y a ${durationStr}\n` +
        `   Entrée: $${fmtPrice(entry)} | Actuel: ${currentStr}${varStr}\n` +
        `   🎯 TP: ${tpStr} | 🛑 SL: ${slStr}`
      );
    }

    const nowParis = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const hh = String(nowParis.getHours()).padStart(2, "0");
    await sendTelegram(
      `📋 <b>TRADES EN COURS — ${hh}:00</b>\n\n` +
      lines.join("\n\n") +
      `\n\n📊 ${pending.length} trade(s) ouvert(s)`
    );
    console.log(`[HourlyRecap] ✓ Envoyé — ${pending.length} trade(s) ouvert(s)`);
  } catch (err) {
    console.error("[HourlyRecap] Erreur:", err instanceof Error ? err.message : err);
  }
}

function scheduleHourlyRecap() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const msUntilNextHour = nextHour.getTime() - now.getTime();
  const minsUntil = Math.ceil(msUntilNextHour / 60000);
  console.log(`[HourlyRecap] Prochain envoi dans ${minsUntil}min`);

  setTimeout(async () => {
    await sendHourlyRecap();
    setInterval(() => sendHourlyRecap(), 60 * 60 * 1000);
  }, msUntilNextHour);
}

scheduleHourlyRecap();

// === DAILY SUMMARY AT 21:00 UTC (23:00 Paris) ===
let dailySummarySent = false;

async function sendDailySummary() {
  if (dailySummarySent) return;
  dailySummarySent = true;
  setTimeout(() => { dailySummarySent = false; }, 60 * 60 * 1000);
  try {
    const data = await db.select().from(signalsTable)
      .where(eq(signalsTable.version, "v4"));

    const resolved = data.filter(s =>
      s.result === "correct" || s.result === "incorrect");
    const correct = resolved.filter(s => s.result === "correct");
    const winRate = resolved.length > 0
      ? (correct.length / resolved.length * 100).toFixed(1)
      : "0";

    let totalPnL = 0;
    resolved.forEach(s => {
      totalPnL += parseFloat(s.pct_change ?? "0");
    });
    const ev = resolved.length > 0
      ? (totalPnL / resolved.length).toFixed(3) + "%"
      : "0%";

    const todayParis = new Date(Date.now() + 2 * 60 * 60 * 1000);
    todayParis.setHours(0, 0, 0, 0);
    const today = new Date(todayParis.getTime() - 2 * 60 * 60 * 1000);
    const todaySignals = data.filter(s => new Date(s.created_at) >= today);
    const todayResolved = todaySignals.filter(s =>
      s.result === "correct" || s.result === "incorrect");
    const todayCorrect = todayResolved.filter(s => s.result === "correct");
    const todayWinRate = todayResolved.length > 0
      ? (todayCorrect.length / todayResolved.length * 100).toFixed(1)
      : "—";

    const todayCorrectSignals = todayResolved.filter(s => s.result === "correct");
    const todayIncorrectSignals = todayResolved.filter(s => s.result === "incorrect");

    const todayLong = todayResolved.filter(s => s.direction === "LONG");
    const todayShort = todayResolved.filter(s => s.direction === "SHORT");
    const longWR = todayLong.length > 0
      ? (todayLong.filter(s => s.result === "correct").length / todayLong.length * 100).toFixed(0)
      : "—";
    const shortWR = todayShort.length > 0
      ? (todayShort.filter(s => s.result === "correct").length / todayShort.length * 100).toFixed(0)
      : "—";
    const marketBias = todayLong.length > todayShort.length ? "🟢 Haussier" :
                       todayShort.length > todayLong.length ? "🔴 Baissier" : "⚪ Neutre";

    let avgDurStr = "N/A";
    const tpWithDuration = todayCorrectSignals.filter(s => s.updated_at != null);
    if (tpWithDuration.length > 0) {
      const totalMs = tpWithDuration.reduce((acc, s) => {
        return acc + (new Date(s.updated_at!).getTime() - new Date(s.created_at).getTime());
      }, 0);
      const avgMin = Math.floor(totalMs / tpWithDuration.length / 60000);
      const avgHours = Math.floor(avgMin / 60);
      const avgMins = avgMin % 60;
      avgDurStr = avgHours > 0 ? `${avgHours}h ${avgMins}min` : `${avgMins}min`;
    }

    const tokenTP: Record<string, number> = {};
    for (const s of todayCorrectSignals) {
      const sym = s.symbol.toUpperCase();
      tokenTP[sym] = (tokenTP[sym] ?? 0) + 1;
    }
    let bestToken = "—";
    if (Object.keys(tokenTP).length > 0) {
      const [bestSym, bestCount] = Object.entries(tokenTP).sort((a, b) => b[1] - a[1])[0];
      bestToken = `${bestSym} (${bestCount} TP)`;
    }

    const tokenSL: Record<string, { sl: number; tp: number }> = {};
    for (const s of todayResolved) {
      const sym = s.symbol.toUpperCase();
      if (!tokenSL[sym]) tokenSL[sym] = { sl: 0, tp: 0 };
      if (s.result === "incorrect") tokenSL[sym].sl++;
      else if (s.result === "correct") tokenSL[sym].tp++;
    }
    let worstToken = "—";
    const worstCandidates = Object.entries(tokenSL)
      .filter(([, v]) => v.tp === 0 && v.sl >= 2)
      .sort((a, b) => b[1].sl - a[1].sl);
    if (worstCandidates.length > 0) {
      const [worstSym, worstStats] = worstCandidates[0];
      worstToken = `${worstSym} (0/${worstStats.sl})`;
    }

    const dateStr = todayParis.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const TP_GAIN = 10;
    const SL_LOSS = -4;
    const simPnL = (todayCorrectSignals.length * TP_GAIN)
                 + (todayIncorrectSignals.length * SL_LOSS);
    const simSign = simPnL >= 0 ? "+" : "";

    await sendTelegram(
      `📊 <b>Résumé journalier TRADEYE V4</b> — ${dateStr}\n` +
      `\n` +
      `📅 Aujourd'hui : ${todaySignals.length} signaux | WR ${todayWinRate}% (${todayCorrect.length}/${todayResolved.length})\n` +
      `📈 LONG : WR ${longWR}% (${todayLong.length} trades)\n` +
      `📉 SHORT : WR ${shortWR}% (${todayShort.length} trades)\n` +
      `🧭 Biais marché : ${marketBias}\n` +
      `\n` +
      `⏱ Durée moy TP : ${avgDurStr}\n` +
      `🏆 Best token : ${bestToken}\n` +
      `💀 À éviter : ${worstToken}\n` +
      `📊 Ratio : ${todayCorrectSignals.length} TP / ${todayIncorrectSignals.length} SL\n` +
      `\n` +
      `💵 Simulation 10€ × x20 :\n` +
      `✅ ${todayCorrectSignals.length} TP × +10€ = +${todayCorrectSignals.length * 10}€\n` +
      `❌ ${todayIncorrectSignals.length} SL × -4€ = ${todayIncorrectSignals.length * -4}€\n` +
      `💰 Net du jour : ${simSign}${simPnL}€\n` +
      `\n` +
      `🔢 Total historique : ${data.length} signaux\n` +
      `✅ Winrate global : ${winRate}% (${correct.length}/${resolved.length})\n` +
      `💰 EV moyen/trade : ${ev}`
    );

    console.log(`[DailySummary] ✓ Envoyé — WR global ${winRate}% EV ${ev}`);
  } catch (err) {
    console.error("[DailySummary] Erreur:", err instanceof Error ? err.message : err);
  }
}

function scheduleDailySummary() {
  const now = new Date();
  const next22h = new Date();
  next22h.setHours(21, 0, 0, 0);
  if (next22h.getTime() <= now.getTime()) {
    next22h.setDate(next22h.getDate() + 1);
  }
  const msUntil22h = next22h.getTime() - now.getTime();
  const hUntil = (msUntil22h / 3_600_000).toFixed(1);
  console.log(`[DailySummary] Prochain envoi dans ${hUntil}h (21:00 UTC / 23:00 Paris)`);

  setTimeout(async () => {
    await sendDailySummary();
    setInterval(() => sendDailySummary(), 24 * 60 * 60 * 1000);
  }, msUntil22h);
}

scheduleDailySummary();

// === TELEGRAM BOT : COMMANDE /export ===
async function handleTelegramExport() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const signals = await db.select().from(signalsTable)
      .where(eq(signalsTable.version, "v4"))
      .orderBy(desc(signalsTable.created_at));

    const resolved = signals.filter(s => s.resolved && s.result);
    const brackets: Record<string, { total: number; correct: number }> = {
      "60-64": { total: 0, correct: 0 },
      "65-69": { total: 0, correct: 0 },
      "70-74": { total: 0, correct: 0 },
      "75+":   { total: 0, correct: 0 },
    };
    const tokenStats: Record<string, { correct: number; total: number }> = {};

    for (const s of resolved) {
      const sc = s.signal_score;
      const key = sc >= 75 ? "75+" : sc >= 70 ? "70-74" : sc >= 65 ? "65-69" : "60-64";
      brackets[key].total++;
      if (s.result === "correct") brackets[key].correct++;
      const sym = s.symbol.toUpperCase();
      if (!tokenStats[sym]) tokenStats[sym] = { correct: 0, total: 0 };
      tokenStats[sym].total++;
      if (s.result === "correct") tokenStats[sym].correct++;
    }

    const topTokens = Object.entries(tokenStats)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))
      .slice(0, 10)
      .map(([sym, v]) => `  ${sym}: ${v.correct}/${v.total} (${((v.correct / v.total) * 100).toFixed(0)}%)`);

    const lines: string[] = [
      "=== TRADEYE V4 — Export Signaux ===",
      `Généré le : ${new Date().toLocaleString("fr-FR")}`,
      `Total : ${signals.length} signaux | ${resolved.length} résolus`,
      "",
      "--- Score Brackets ---",
      ...Object.entries(brackets).map(([range, v]) =>
        `  ${range}: ${v.correct}/${v.total} correct (${v.total > 0 ? ((v.correct / v.total) * 100).toFixed(0) : 0}%)`
      ),
      "",
      "--- Top Tokens ---",
      ...(topTokens.length ? topTokens : ["  Pas encore de données"]),
      "",
      "--- Historique ---",
      ...signals.map(s => {
        const date = new Date(s.created_at).toLocaleString("fr-FR");
        const tp = s.tp_price ? ` | TP:$${s.tp_price}` : "";
        const sl = s.sl_price ? ` | SL:$${s.sl_price}` : "";
        const status = s.resolved
          ? `${s.result?.toUpperCase()} | $${s.exit_price} | ${s.pct_change ? (parseFloat(s.pct_change) >= 0 ? "+" : "") + parseFloat(s.pct_change).toFixed(2) + "%" : ""} | ${s.pts}/10`
          : "EN COURS";
        return `[${date}] ${s.direction} ${s.symbol.toUpperCase()} | Score: ${s.signal_score}/100 | $${s.entry_price}${tp}${sl} | ${status}`;
      }),
    ];

    const content = lines.join("\n");
    const form = new FormData();
    form.append("chat_id", CHAT_ID);
    form.append("document", new Blob([content], { type: "text/plain" }), "tradeye_v4_export.txt");
    form.append("caption", "📊 Export complet TRADEYE V4");

    const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const sendData = (await sendRes.json()) as { ok: boolean; description?: string };
    if (sendData.ok) {
      console.log(`[Telegram] ✓ /export envoyé (${signals.length} signaux)`);
    } else {
      console.error(`[Telegram] /export échec:`, sendData.description);
    }
  } catch (err) {
    console.error("[Telegram] handleTelegramExport erreur:", err instanceof Error ? err.message : err);
  }
}

let lastUpdateId = 0;

async function pollTelegramCommands() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=0&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?: { text?: string; chat?: { id: number | string } };
      }>;
    };
    if (!data.ok || !data.result.length) return;
    for (const update of data.result) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      const msg = update.message;
      if (!msg?.text) continue;
      if (String(msg?.chat?.id) !== String(CHAT_ID)) continue;
      if (msg.text.trim() === "/export") {
        console.log("[Telegram] Commande /export reçue");
        await handleTelegramExport();
      }
    }
  } catch (err) {
    console.warn("[Telegram] pollTelegramCommands erreur:", err instanceof Error ? err.message : err);
  }
}

setTimeout(() => pollTelegramCommands(), 5_000);
setInterval(() => pollTelegramCommands(), 30_000);
console.log("[Telegram] Polling /export actif (toutes les 30s)");

// === GRACEFUL SHUTDOWN ===
process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received — graceful shutdown");
  try {
    await gracefulShutdown();
    await sendTelegram("⚠️ TRADEYE redémarré automatiquement").catch(() => {});
    console.log("[server] Signals resolved before exit");
  } catch (e: any) {
    console.error("[server] Error during shutdown:", e.message);
  }
  setTimeout(() => process.exit(0), 1500);
});

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err.message);
  sendTelegram(`❌ Crash : ${err.message}`).catch(() => {});
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
