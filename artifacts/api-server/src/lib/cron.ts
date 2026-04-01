import { db, pool } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import { getBinanceData } from "./binance.js";
import { scoreLong, scoreShort, type CoinData } from "./scoring.js";
import { sendTelegram, formatSignalMessage, formatResultMessage } from "./telegram.js";
import { runV3Stats } from "../analysis/v3Stats.js";

const MIN_SCORE = 60;
const MIN_VOLUME = 3_000_000;
const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const ANTI_CONFLICT_MS = 2 * 60 * 60 * 1000;
const RESOLUTION_WINDOW_MS = 45 * 60 * 1000;
const TP_PCT = 0.05;
const SL_PCT = 0.02;
const VERSION = "v4";

let isCronRunning = false;
let cronInterval: ReturnType<typeof setInterval> | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;

interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_1h_in_currency: number;
  price_change_percentage_24h_in_currency: number;
  market_cap: number;
}

async function fetchCoinGeckoPage(page: number): Promise<CoinGeckoCoin[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=1h%2C24h`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CoinGecko page ${page} failed: ${res.status}`);
  return res.json();
}

async function getBtcTrend(): Promise<"BULL" | "BEAR" | "NEUTRAL"> {
  try {
    const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=1h";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "NEUTRAL";
    const data = (await res.json()) as CoinGeckoCoin[];
    const btc = data[0];
    if (!btc) return "NEUTRAL";
    const ch1h = btc.price_change_percentage_1h_in_currency;
    if (ch1h > 1.5) return "BULL";
    if (ch1h < -1.5) return "BEAR";
    return "NEUTRAL";
  } catch {
    return "NEUTRAL";
  }
}

async function resolveSignals(): Promise<void> {
  let pendingSignals;
  try {
    pendingSignals = await db
      .select()
      .from(signalsTable)
      .where(and(eq(signalsTable.resolved, false), eq(signalsTable.version, VERSION)));
  } catch (err) {
    console.error("[Cron] Error fetching pending signals:", err);
    return;
  }

  if (pendingSignals.length === 0) return;
  console.log(`[Cron] Resolving ${pendingSignals.length} pending signals...`);

  const now = new Date();
  const coinIds = [...new Set(pendingSignals.map((s) => s.coin_id))];
  const idsParam = coinIds.join(",");
  let priceMap: Record<string, number> = {};

  try {
    const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd`;
    const res = await fetch(priceUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd: number }>;
      for (const [id, val] of Object.entries(data)) {
        priceMap[id] = val.usd;
      }
    }
  } catch {
    console.error("[Cron] Price fetch for resolution failed");
    return;
  }

  for (const signal of pendingSignals) {
    const age = now.getTime() - new Date(signal.created_at).getTime();
    if (age < RESOLUTION_WINDOW_MS) continue;

    const currentPrice = priceMap[signal.coin_id];
    if (!currentPrice) continue;

    const entry = parseFloat(signal.entry_price);
    const tp = parseFloat(signal.tp_price ?? "0");
    const sl = parseFloat(signal.sl_price ?? "0");
    if (!entry || !tp || !sl) continue;

    const pctChangeRaw = ((currentPrice - entry) / entry) * 100;
    const pctChangeForDir = signal.direction === "LONG" ? pctChangeRaw : -pctChangeRaw;

    let resolved = false;
    let result = "neutre";
    let pts = 5;
    let isTP = false;

    if (signal.direction === "LONG") {
      if (currentPrice >= tp) {
        resolved = true;
        result = "correct";
        pts = 10;
        isTP = true;
      } else if (currentPrice <= sl) {
        resolved = true;
        result = "incorrect";
        pts = 0;
        isTP = false;
      }
    } else {
      if (currentPrice <= tp) {
        resolved = true;
        result = "correct";
        pts = 10;
        isTP = true;
      } else if (currentPrice >= sl) {
        resolved = true;
        result = "incorrect";
        pts = 0;
        isTP = false;
      }
    }

    if (!resolved && age > RESOLUTION_WINDOW_MS) {
      resolved = true;
      result = pctChangeForDir >= 0 ? "correct" : "incorrect";
      pts = pctChangeForDir >= 2 ? 10 : pctChangeForDir >= 0 ? 7 : pctChangeForDir >= -1 ? 3 : 0;
    }

    if (resolved) {
      await db
        .update(signalsTable)
        .set({
          resolved: true,
          result,
          exit_price: String(currentPrice),
          pct_change: String(pctChangeRaw.toFixed(3)),
          pts,
          updated_at: now,
        })
        .where(eq(signalsTable.id, signal.id));

      const duration = now.getTime() - new Date(signal.created_at).getTime();
      const msg = formatResultMessage(
        signal.symbol,
        signal.direction,
        signal.entry_price,
        String(currentPrice),
        String(pctChangeRaw.toFixed(3)),
        pts,
        isTP,
        duration,
      );
      sendTelegram(msg).catch(() => {});
      console.log(`[Cron] Resolved ${signal.symbol} ${signal.direction}: ${result} (${pctChangeRaw.toFixed(2)}%)`);
    }
  }
}

async function runCronCycle(): Promise<void> {
  if (isCronRunning) {
    console.log("[Cron] Cycle déjà en cours, skip");
    return;
  }
  isCronRunning = true;
  const start = Date.now();
  console.log(`[Cron] === CYCLE DÉMARRÉ ===`);

  try {
    await resolveSignals();

    let allCoins: CoinGeckoCoin[] = [];
    try {
      const [page1, page2] = await Promise.all([
        fetchCoinGeckoPage(1),
        fetchCoinGeckoPage(2),
      ]);
      allCoins = [...page1, ...page2];
      console.log(`[Cron] CoinGecko: ${allCoins.length} coins récupérés`);
    } catch (err) {
      console.error("[Cron] CoinGecko fetch error:", err);
      return;
    }

    const btcTrend = await getBtcTrend();
    console.log(`[Cron] BTC Trend: ${btcTrend}`);

    const eligible = allCoins.filter(
      (c) =>
        c.total_volume >= MIN_VOLUME &&
        c.current_price > 0 &&
        c.symbol.toLowerCase() !== "usdt" &&
        c.symbol.toLowerCase() !== "usdc" &&
        c.symbol.toLowerCase() !== "busd" &&
        c.symbol.toLowerCase() !== "dai" &&
        c.symbol.toLowerCase() !== "tusd" &&
        c.symbol.toLowerCase() !== "usdp",
    );

    console.log(`[Cron] ${eligible.length} coins éligibles (vol > $${(MIN_VOLUME / 1e6).toFixed(0)}M)`);

    let existingPending;
    try {
      existingPending = await db
        .select()
        .from(signalsTable)
        .where(and(eq(signalsTable.resolved, false), eq(signalsTable.version, VERSION)));
    } catch (err) {
      console.error("[Cron] Error fetching existing pending:", err);
      return;
    }

    const now = new Date();

    const recentSignals = existingPending.filter(
      (s) => now.getTime() - new Date(s.created_at).getTime() < DEDUP_WINDOW_MS,
    );
    const recentCoinIds = new Set(recentSignals.map((s) => s.coin_id));

    const hasActiveLong = existingPending.some(
      (s) =>
        s.direction === "LONG" &&
        now.getTime() - new Date(s.created_at).getTime() < ANTI_CONFLICT_MS,
    );
    const hasActiveShort = existingPending.some(
      (s) =>
        s.direction === "SHORT" &&
        now.getTime() - new Date(s.created_at).getTime() < ANTI_CONFLICT_MS,
    );

    console.log(`[Cron] Anti-conflict: LONG=${hasActiveLong} SHORT=${hasActiveShort}`);

    const candidates: {
      coin: CoinGeckoCoin;
      direction: "LONG" | "SHORT";
      score: number;
      reasons: string[];
      binance: any;
    }[] = [];

    const BATCH = 25;
    for (let i = 0; i < Math.min(eligible.length, 200); i += BATCH) {
      const batch = eligible.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (coin) => {
          try {
            const binanceSymbol = `${coin.symbol.toUpperCase()}USDT`;
            const binanceData = await getBinanceData(binanceSymbol);

            const coinData: CoinData = {
              id: coin.id,
              symbol: coin.symbol,
              name: coin.name,
              image: coin.image,
              current_price: coin.current_price,
              price_change_percentage_1h_in_currency: coin.price_change_percentage_1h_in_currency,
              price_change_percentage_24h_in_currency: coin.price_change_percentage_24h_in_currency,
              total_volume: coin.total_volume,
            };

            if (!hasActiveLong && btcTrend !== "BEAR") {
              const { score, reasons } = scoreLong(coinData, binanceData);
              if (score >= MIN_SCORE && !recentCoinIds.has(coin.id)) {
                candidates.push({ coin, direction: "LONG", score, reasons, binance: binanceData });
              }
            }

            if (!hasActiveShort && btcTrend !== "BULL") {
              const { score, reasons } = scoreShort(coinData, binanceData);
              if (score >= MIN_SCORE && !recentCoinIds.has(coin.id)) {
                candidates.push({ coin, direction: "SHORT", score, reasons, binance: binanceData });
              }
            }
          } catch {
            // Silent fail per coin
          }
        }),
      );
      if (i + BATCH < Math.min(eligible.length, 200)) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (candidates.length === 0) {
      console.log("[Cron] Aucun signal qualifié ce cycle");
    }

    candidates.sort((a, b) => b.score - a.score);

    let longInserted = false;
    let shortInserted = false;

    for (const c of candidates) {
      if (c.direction === "LONG" && longInserted) continue;
      if (c.direction === "LONG" && hasActiveLong) continue;
      if (c.direction === "SHORT" && shortInserted) continue;
      if (c.direction === "SHORT" && hasActiveShort) continue;

      const entry = c.coin.current_price;
      const tpPrice = c.direction === "LONG" ? entry * (1 + TP_PCT) : entry * (1 - TP_PCT);
      const slPrice = c.direction === "LONG" ? entry * (1 - SL_PCT) : entry * (1 + SL_PCT);

      try {
        const [inserted] = await db
          .insert(signalsTable)
          .values({
            coin_id: c.coin.id,
            symbol: c.coin.symbol,
            image: c.coin.image,
            direction: c.direction,
            entry_price: String(entry),
            signal_score: c.score,
            version: VERSION,
            funding_rate: c.binance?.fundingRate != null ? String(c.binance.fundingRate) : null,
            rsi_15m: c.binance?.rsi != null ? String(c.binance.rsi.toFixed(1)) : null,
            oi_change: c.binance?.oiChange != null ? String(c.binance.oiChange.toFixed(2)) : null,
            reasons: c.reasons.join(" | "),
            change_1h: String(c.coin.price_change_percentage_1h_in_currency),
            change_24h: String(c.coin.price_change_percentage_24h_in_currency),
            tp_price: String(tpPrice),
            sl_price: String(slPrice),
            created_at: now,
          })
          .returning();

        const msg = formatSignalMessage(
          c.coin.symbol,
          c.direction,
          c.score,
          String(entry),
          c.reasons,
          now,
          c.binance?.rsi,
          c.binance?.fundingRate,
          c.binance?.oiChange,
          String(tpPrice),
          String(slPrice),
        );

        sendTelegram(msg).catch(() => {});
        console.log(`[Cron] ✓ Signal ${c.direction} ${c.coin.symbol.toUpperCase()} score=${c.score}`);

        if (c.direction === "LONG") longInserted = true;
        else shortInserted = true;

        if (longInserted && shortInserted) break;
      } catch (err) {
        console.error(`[Cron] Error inserting signal for ${c.coin.symbol}:`, err);
      }
    }
  } catch (err) {
    console.error("[Cron] Cycle error:", err);
  } finally {
    isCronRunning = false;
    const elapsed = Date.now() - start;
    console.log(`[Cron] === CYCLE TERMINÉ (${(elapsed / 1000).toFixed(1)}s) ===`);
  }
}

export function startCron(): void {
  console.log("[Cron] Démarrage — cycle toutes les 5 minutes");
  cronInterval = setInterval(() => {
    runCronCycle().catch((err) => console.error("[Cron] Unhandled cycle error:", err));
  }, 5 * 60 * 1000);

  statsInterval = setInterval(
    () => {
      runV3Stats().catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );

  runCronCycle().catch((err) => console.error("[Cron] Initial cycle error:", err));
}

export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}
