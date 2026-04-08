import { db, pool } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { and, eq, gte, or } from "drizzle-orm";
import { getBinanceData, getBinanceRsiOnly, type BinanceData } from "./binance.js";
import { getCoinGeckoOhlcData } from "./coingecko_ohlc.js";
import { scoreLong, scoreShort, type CoinData } from "./scoring.js";
import { sendTelegram, formatSignalMessage, formatResultMessage } from "./telegram.js";
import { runV3Stats } from "../analysis/v3Stats.js";

export const dbErrors: { ts: string; symbol: string; direction: string; error: string }[] = [];

// Mapping étendu CoinGecko → Binance
export const COINGECKO_MAPPING: Record<string, string> = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT",
  dogecoin: "DOGEUSDT",
  cardano: "ADAUSDT",
  "avalanche-2": "AVAXUSDT",
  chainlink: "LINKUSDT",
  polkadot: "DOTUSDT",
  "matic-network": "MATICUSDT",
  uniswap: "UNIUSDT",
  litecoin: "LTCUSDT",
  stellar: "XLMUSDT",
  cosmos: "ATOMUSDT",
  near: "NEARUSDT",
  aptos: "APTUSDT",
  sui: "SUIUSDT",
  arbitrum: "ARBUSDT",
  optimism: "OPUSDT",
  filecoin: "FILUSDT",
  "fetch-ai": "FETUSDT",
  neo: "NEOUSDT",
  qtum: "QTUMUSDT",
  zcash: "ZECUSDT",
  "conflux-token": "CFXUSDT",
  flow: "FLOWUSDT",
  "pancakeswap-token": "CAKEUSDT",
  "eigen-layer": "EIGENUSDT",
  "berachain-bera": "BERAUSDT",
  "the-open-network": "TONUSDT",
  kaspa: "KASUSDT",
  "injective-protocol": "INJUSDT",
  "sei-network": "SEIUSDT",
  celestia: "TIAUSDT",
  "pyth-network": "PYTHUSDT",
  starknet: "STRKUSDT",
  ethena: "ENAUSDT",
  pepe: "PEPEUSDT",
  floki: "FLOKIUSDT",
  gala: "GALAUSDT",
  chiliz: "CHZUSDT",
  kava: "KAVAUSDT",
  dydx: "DYDXUSDT",
  blur: "BLURUSDT",
  apecoin: "APEUSDT",
  tron: "TRXUSDT",
  "ethereum-classic": "ETCUSDT",
  "bitcoin-cash": "BCHUSDT",
  "theta-token": "THETAUSDT",
  harmony: "ONEUSDT",
  eos: "EOSUSDT",
  tezos: "XTZUSDT",
  vechain: "VETUSDT",
  algorand: "ALGOUSDT",
  iota: "IOTAUSDT",
  waves: "WAVESUSDT",
  dash: "DASHUSDT",
  movement: "MOVEUSDT",
  "jupiter-exchange-solana": "JUPUSDT",
  not: "NOTUSDT",
  "render-token": "RENDERUSDT",
  "hedera-hashgraph": "HBARUSDT",
  aave: "AAVEUSDT",
  decentraland: "MANAUSDT",
  "axie-infinity": "AXSUSDT",
  "the-sandbox": "SANDUSDT",
  "immutable-x": "IMXUSDT",
  enjincoin: "ENJUSDT",
  "basic-attention-token": "BATUSDT",
  zilliqa: "ZILUSDT",
  "iexec-rlc": "RLCUSDT",
  ankr: "ANKRUSDT",
};

const MIN_SCORE = 70;          // Score minimum FINAL pour émettre un signal
// PRE_SCORE_THRESHOLD est calculé dynamiquement chaque cycle selon la dispersion marché
const MIN_VOLUME = 3_000_000;
const BLACKLISTED_TOKENS = ["BAN", "AKT", "M", "TRIA", "ANKR", "PIPPIN"];
const DEDUP_MINUTES = 120;
const CONFLICT_MINUTES = 120;

let isRunning = false;
let cgPaused = false;

// Cache de prix rempli à chaque cycle principal
const priceCache: Map<string, { price: number; ts: number }> = new Map();
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCachedPrice(coinId: string, price: number) {
  priceCache.set(coinId, { price, ts: Date.now() });
}

export function getCachedPrice(coinId: string): number | null {
  const entry = priceCache.get(coinId);
  if (!entry) return null;
  if (Date.now() - entry.ts > PRICE_CACHE_TTL) {
    priceCache.delete(coinId);
    return null;
  }
  return entry.price;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Prix BTC du cycle précédent pour calcul de tendance (comparaison ~5min en mémoire)
let lastBtcPrice: number | null = null;

function computeBtcTrend(curr: number): { trend: "UP" | "DOWN" | "NEUTRAL"; pct: number; prev: number; curr: number } {
  if (lastBtcPrice === null || lastBtcPrice === 0) {
    // Premier cycle : pas encore de référence
    lastBtcPrice = curr;
    return { trend: "NEUTRAL", pct: 0, prev: curr, curr };
  }
  const prev = lastBtcPrice;
  const pct = ((curr - prev) / prev) * 100;
  const trend = pct <= -0.5 ? "DOWN" : pct >= 0.5 ? "UP" : "NEUTRAL";
  lastBtcPrice = curr; // mise à jour pour le prochain cycle
  return { trend, pct, prev, curr };
}

async function dbQuery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.message?.includes("terminating") || err?.message?.includes("connection")) {
      console.error("[DB] Connection lost — retrying in 2s");
      await sleep(2000);
      return await fn();
    }
    throw err;
  }
}

let last429Ts = 0;
const COOLDOWN_429_MS = 5 * 60 * 1000; // 5 min

async function fetchAllCoins(): Promise<CoinData[]> {
  console.log("[CoinGecko] Début fetch top 500...");
  const all: CoinData[] = [];
  const MAX_RETRIES = 3;

  for (let page = 1; page <= 2; page++) {
    let backoff = 30_000;
    let ok = false;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=1h%2C24h`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 429) {
          last429Ts = Date.now();
          console.log(`[CoinGecko] 429 — backoff ${backoff / 1000}s (retry ${retry + 1}/${MAX_RETRIES})`);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 180_000);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as CoinData[];
        all.push(...data);
        console.log(`[CoinGecko] Page ${page} OK (${data.length} coins)`);
        if (page < 2) await sleep(4000);
        ok = true;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[CoinGecko] Erreur page ${page} retry ${retry + 1}:`, msg);
        if (retry === MAX_RETRIES - 1) {
          console.log("[CoinGecko] Skip cycle après erreurs répétées");
          return [];
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 180_000);
      }
    }

    if (!ok) return [];
  }

  const filtered = all.filter(c => (c.total_volume || 0) > MIN_VOLUME);
  console.log(`[CoinGecko] ${filtered.length} coins liquides retenus`);
  return filtered;
}

async function getCoinGeckoPricesBatch(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  try {
    const ids = coinIds.join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status === 429) {
      last429Ts = Date.now();
      console.warn("[CoinGecko] 429 sur simple/price — skip prix");
      return {};
    }
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, { usd: number }>;
    const result: Record<string, number> = {};
    for (const id of coinIds) {
      if (data[id]?.usd) result[id] = data[id].usd;
    }
    return result;
  } catch {
    return {};
  }
}

async function getBinancePrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { price: string };
    const price = parseFloat(data.price);
    return !isNaN(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function resolveSignals() {
  // V4 : vérifier TOUS les signaux non résolus — aucun cutoff de temps
  const pending = await dbQuery(() =>
    db.select().from(signalsTable).where(eq(signalsTable.resolved, false))
  );

  if (pending.length === 0) return;

  // Collecte des prix — priorité : cache → Binance → CoinGecko batch
  const signalPrices: Record<number, number> = {};
  const needBinance: typeof pending = [];
  const needCG: string[] = [];

  for (const signal of pending) {
    const cached = getCachedPrice(signal.coin_id);
    if (cached !== null) {
      signalPrices[signal.id] = cached;
    } else if (COINGECKO_MAPPING[signal.coin_id]) {
      needBinance.push(signal);
    } else {
      needCG.push(signal.coin_id);
    }
  }

  for (const signal of needBinance) {
    const sym = COINGECKO_MAPPING[signal.coin_id];
    const price = await getBinancePrice(sym);
    if (price !== null) {
      signalPrices[signal.id] = price;
      setCachedPrice(signal.coin_id, price);
    } else {
      needCG.push(signal.coin_id);
    }
  }

  const uniqueCgIds = [...new Set(needCG)];
  const cgPrices = uniqueCgIds.length > 0 ? await getCoinGeckoPricesBatch(uniqueCgIds) : {};
  for (const signal of pending) {
    if (signalPrices[signal.id] == null && cgPrices[signal.coin_id] != null) {
      signalPrices[signal.id] = cgPrices[signal.coin_id];
      setCachedPrice(signal.coin_id, cgPrices[signal.coin_id]);
    }
  }

  // Résolution TP/SL pour chaque signal
  for (const signal of pending) {
    try {
      // Skip signaux sans TP/SL (legacy)
      if (!signal.tp_price || !signal.sl_price) {
        continue;
      }

      const currentPrice = signalPrices[signal.id] ?? null;
      if (currentPrice === null) {
        console.warn(`[CronJob] Prix introuvable pour ${signal.symbol} (${signal.coin_id})`);
        continue;
      }

      const tp = parseFloat(signal.tp_price);
      const sl = parseFloat(signal.sl_price);
      const entry = parseFloat(signal.entry_price);

      let isTP = false;
      let isSL = false;

      if (signal.direction === "LONG") {
        if (currentPrice >= tp) isTP = true;
        else if (currentPrice <= sl) isSL = true;
      } else {
        if (currentPrice <= tp) isTP = true;
        else if (currentPrice >= sl) isSL = true;
      }

      if (!isTP && !isSL) continue; // Signal toujours ouvert — rien à faire

      const rawPct = ((currentPrice - entry) / entry) * 100;
      const result = isTP ? "correct" : "incorrect";
      const pts = isTP ? 10 : 0;
      const durationMs = Date.now() - new Date(signal.created_at).getTime();

      await dbQuery(() =>
        db.update(signalsTable).set({
          resolved: true,
          exit_price: currentPrice.toString(),
          pct_change: rawPct.toFixed(4),
          result,
          pts,
          updated_at: new Date(),
        }).where(eq(signalsTable.id, signal.id))
      );

      const exitPriceStr = currentPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
      const label = isTP ? "TP" : "SL";
      const sign = rawPct >= 0 ? "+" : "";
      console.log(`[V5] Resolved: ${signal.symbol.toUpperCase()} ${signal.direction} ${label} ${result} ${sign}${rawPct.toFixed(2)}%`);

      const msg = formatResultMessage(
        signal.symbol,
        signal.direction,
        signal.entry_price,
        exitPriceStr,
        rawPct.toFixed(4),
        pts,
        isTP,
        durationMs,
      );
      await sendTelegram(msg);
    } catch (err) {
      console.error(`[CronJob] Erreur résolution signal ${signal.id} (${signal.symbol}):`, err);
    }
  }
}

export async function runCron() {
  console.log(`[V5] Cycle — pool total:${pool.totalCount} idle:${pool.idleCount} waiting:${pool.waitingCount}`);
  if (isRunning) {
    console.log("[CronJob] Already running, skipping");
    return;
  }
  isRunning = true; // Verrou immédiat — avant tout await pour éviter la race condition

  if (last429Ts && Date.now() - last429Ts < COOLDOWN_429_MS) {
    const remaining = Math.ceil((COOLDOWN_429_MS - (Date.now() - last429Ts)) / 1000);
    console.log(`[CoinGecko] Cooldown 429 actif — skip cycle (${remaining}s restantes)`);
    isRunning = false;
    return;
  }
  // DB connection check
  try {
    await dbQuery(() => db.select().from(signalsTable).limit(1));
  } catch (err) {
    console.error("[DB] Connection not ready — skip cycle");
    isRunning = false;
    return;
  }

  cgPaused = false;

  const cycleStart = Date.now();
  let statsEmittedThisCycle = false;
  try {
    console.log(`[V5] Cycle @ ${new Date().toISOString()} — activité Replit simulée`);

    // 0. Résolution préventive avec prix du cycle précédent (avant fetch frais)
    await resolveSignals();

    // 1. Fetch des coins
    const coins = await fetchAllCoins();

    // 2. Si des coins disponibles, remplir le cache de prix en premier
    if (coins.length > 0) {
      for (const coin of coins) {
        if (coin.current_price > 0) {
          setCachedPrice(coin.id, coin.current_price);
        }
      }
    }

    // 3. Résolution TP/SL — TOUJOURS exécutée, même si fetchAllCoins a échoué (429)
    //    Le cache précédent ou le fallback CoinGecko batch sont utilisés
    await resolveSignals();

    // 4. Skip génération signaux si pas de données de marché
    if (coins.length === 0) {
      console.log("[CronJob] Aucun coin — skip génération signaux");
      return;
    }

    // 5. Filtre liquidité
    const liquid = coins.filter(
      (c) =>
        c.total_volume >= MIN_VOLUME &&
        c.current_price > 0 &&
        c.price_change_percentage_1h_in_currency != null &&
        c.price_change_percentage_24h_in_currency != null
    );

    console.log(`[V5] ${liquid.length} coins liquides (vol > $${(MIN_VOLUME / 1e6).toFixed(0)}M)`);

    // Dispersion marché : % de coins avec |ch1h| > 2%
    const movingCount = liquid.filter(c => Math.abs(c.price_change_percentage_1h_in_currency ?? 0) > 2).length;
    const dispersionPct = liquid.length > 0 ? (movingCount / liquid.length) * 100 : 0;
    let preScoreThreshold: number;
    let marketContext: string;
    if (dispersionPct > 15) {
      preScoreThreshold = 35;
      marketContext = "marché actif";
    } else if (dispersionPct >= 8) {
      preScoreThreshold = 40;
      marketContext = "marché normal";
    } else {
      preScoreThreshold = 50;
      marketContext = "marché calme";
    }
    console.log(`[MARKET] Dispersion: ${dispersionPct.toFixed(1)}% tokens bougent > 2% sur 1h — ${dispersionPct > 15 ? "contexte favorable" : dispersionPct >= 8 ? "contexte normal" : "contexte peu actif"}`);
    console.log(`[MARKET] PRE_SCORE_THRESHOLD ajusté à ${preScoreThreshold} (${marketContext})`);

    // 5. Scoring LONG et SHORT pour tous les coins
    const candidates: Array<{
      coin: CoinData;
      longScore: number;
      shortScore: number;
      longReasons: string[];
      shortReasons: string[];
      binanceData?: BinanceData;
    }> = [];

    let bestShortScore = 0;
    let bestShortSymbol = "";
    let bestLongScore = 0;
    let bestLongSymbol = "";

    // Coins éliminés avec un move 1h significatif (pour debug)
    const eliminatedMovers: Array<{ symbol: string; ch1h: number; ch24h: number; longScore: number; shortScore: number; longReasons: string[]; shortReasons: string[] }> = [];

    const DEBUG_TOKENS = ["bitcoin", "ethereum"];

    for (const coin of liquid) {
      const ls = scoreLong(coin);
      const ss = scoreShort(coin);

      if (ls.score > bestLongScore) { bestLongScore = ls.score; bestLongSymbol = coin.symbol; }
      if (ss.score > bestShortScore) { bestShortScore = ss.score; bestShortSymbol = coin.symbol; }

      if (DEBUG_TOKENS.includes(coin.id)) {
        console.log(`[DEBUG ${coin.symbol.toUpperCase()}] Pre-score LONG=${ls.score} SHORT=${ss.score} — ${ls.score >= preScoreThreshold || ss.score >= preScoreThreshold ? "✅ dans candidates" : `❌ éliminé (< ${preScoreThreshold})`}`);
      }

      if (ls.score >= preScoreThreshold || ss.score >= preScoreThreshold) {
        candidates.push({
          coin,
          longScore: ls.score,
          shortScore: ss.score,
          longReasons: ls.reasons,
          shortReasons: ss.reasons,
        });
      } else {
        const ch1h = coin.price_change_percentage_1h_in_currency;
        const ch24h = coin.price_change_percentage_24h_in_currency;

        let boostedLong = ls.score;
        let boostedShort = ss.score;
        let boostedEntry = false;

        // Gros mover LONG potentiel : 1h entre +3% et +10% ET 24h positif
        if (ch1h >= 3 && ch1h <= 10 && ch24h > 0) {
          boostedLong = Math.max(ls.score, 40);
          boostedEntry = true;
          console.log(`[PRE-SCORE] ${coin.symbol.toUpperCase()} 1h=+${ch1h.toFixed(1)}% → candidat LONG potentiel (40pts)`);
        }

        // Gros mover SHORT potentiel : 1h entre -3% et -10% (24h non requis — baisse 1h suffit)
        if (ch1h <= -3 && ch1h >= -10) {
          boostedShort = Math.max(ss.score, 40);
          boostedEntry = true;
          console.log(`[PRE-SCORE] ${coin.symbol.toUpperCase()} 1h=${ch1h.toFixed(1)}% 24h=${ch24h >= 0 ? '+' : ''}${ch24h.toFixed(1)}% → candidat SHORT potentiel (40pts)`);
        }

        if (boostedEntry) {
          candidates.push({ coin, longScore: boostedLong, shortScore: boostedShort, longReasons: ls.reasons, shortReasons: ss.reasons });
        } else if (Math.abs(ch1h) >= 3) {
          // Tracker les gros movers encore éliminés (|ch1h| >= 3%)
          eliminatedMovers.push({ symbol: coin.symbol.toUpperCase(), ch1h, ch24h, longScore: ls.score, shortScore: ss.score, longReasons: ls.reasons, shortReasons: ss.reasons });
        }
      }
    }

    const top3LongPre = [...candidates].sort((a, b) => b.longScore - a.longScore).slice(0, 3);
    const top3ShortPre = [...candidates].sort((a, b) => b.shortScore - a.shortScore).slice(0, 3);
    const fmtList = (arr: typeof candidates, key: "longScore" | "shortScore") =>
      arr.map(c => `${c.coin.symbol.toUpperCase()}(${c[key]})`).join(" ") || "none";
    console.log(`[V5] Pre-score top LONG: ${fmtList(top3LongPre, "longScore")}`);
    console.log(`[V5] Pre-score top SHORT: ${fmtList(top3ShortPre, "shortScore")}`);
    console.log(`[V5] Best scores globaux — LONG: ${bestLongSymbol.toUpperCase()}(${bestLongScore}) | SHORT: ${bestShortSymbol.toUpperCase()}(${bestShortScore})`);
    console.log(`[V5] ${candidates.length} candidat(s) >= ${preScoreThreshold} (pre-score threshold)`);

    // Log les gros movers éliminés (top 5 par |ch1h|)
    if (eliminatedMovers.length > 0) {
      eliminatedMovers.sort((a, b) => Math.abs(b.ch1h) - Math.abs(a.ch1h));
      const top5 = eliminatedMovers.slice(0, 5);
      console.log(`[V5] Movers éliminés (|1h| >= 3%) :`);
      for (const m of top5) {
        const sign = m.ch1h >= 0 ? "+" : "";
        const whyLong = m.longReasons.slice(0, 2).join(" | ") || "—";
        const whyShort = m.shortReasons.slice(0, 2).join(" | ") || "—";
        const sign24 = m.ch24h >= 0 ? "+" : "";
        console.log(`  ${m.symbol} 1h=${sign}${m.ch1h.toFixed(2)}% 24h=${sign24}${m.ch24h.toFixed(2)}% → LONG=${m.longScore} SHORT=${m.shortScore} | ${whyLong}`);
      }
    }

    // Trace BTC/ETH rank dans le classement
    for (const id of DEBUG_TOKENS) {
      const c = candidates.find(x => x.coin.id === id);
      if (!c) continue;
      const sym = c.coin.symbol.toUpperCase();
      const longRank = [...candidates].sort((a, b) => b.longScore - a.longScore).findIndex(x => x.coin.id === id) + 1;
      const shortRank = [...candidates].sort((a, b) => b.shortScore - a.shortScore).findIndex(x => x.coin.id === id) + 1;
      const inTop3Long = longRank > 0 && longRank <= 3;
      const inTop3Short = shortRank > 0 && shortRank <= 3;
      const binanceKey = COINGECKO_MAPPING[id];
      console.log(`[DEBUG ${sym}] Rank LONG=#${longRank || "N/A"} SHORT=#${shortRank || "N/A"} — enrichissement: ${inTop3Long || inTop3Short ? "✅ OUI (top3)" : "❌ NON (hors top3) → [SCORING] bloqué prévu"} — Binance key: ${binanceKey || "non mappé"} — Fallback CG OHLC: ${binanceKey ? "s'activerait si top3" : "s'activerait (branche else)"}`);
    }

    // 6. Enrichissement dual-source : top 3 LONG + top 3 SHORT
    // Pas de filtre MIN_SCORE ici — le filtre final est appliqué après enrichissement OHLC
    const top3Long = [...candidates]
      .sort((a, b) => b.longScore - a.longScore)
      .slice(0, 3);
    const top3Short = [...candidates]
      .sort((a, b) => b.shortScore - a.shortScore)
      .slice(0, 3);

    const toEnrichMap = new Map<string, typeof candidates[0]>();
    for (const c of [...top3Long, ...top3Short]) toEnrichMap.set(c.coin.id, c);
    const toEnrich = [...toEnrichMap.values()];

    const enrichedMap = new Map<string, typeof candidates[0]>();

    for (const c of toEnrich) {
      const binanceSymbol = COINGECKO_MAPPING[c.coin.id];

      let bd: BinanceData | undefined;
      if (binanceSymbol) {
        try {
          bd = await getBinanceData(binanceSymbol);
          const rsiStr = bd.rsi != null ? `RSI=${bd.rsi.toFixed(0)}` : "";
          const frStr  = bd.fundingRate != null ? `FR=${bd.fundingRate.toFixed(4)}` : "";
          const oiStr  = bd.oiChange != null ? `OI=${bd.oiChange >= 0 ? "+" : ""}${bd.oiChange.toFixed(1)}%` : "";
          const parts  = [rsiStr, frStr, oiStr].filter(Boolean).join(" ");
          console.log(`[Binance] ${binanceSymbol}: ${parts || "no data"}`);
        } catch {
          console.log(`[Binance] ${binanceSymbol}: fetch failed`);
        }
        // Fallback CoinGecko OHLC si Binance n'a pas fourni RSI/MACD/BB
        if (!bd || (bd.rsi == null && bd.macd == null && bd.bb == null)) {
          const cgData = await getCoinGeckoOhlcData(c.coin.id);
          if (cgData != null) {
            // Fusionner : conserver OI + fundingRate de Binance si disponibles
            bd = {
              ...cgData,
              oiChange: bd?.oiChange ?? null,
              fundingRate: bd?.fundingRate ?? null,
            };
            console.log(`[CoinGecko OHLC] ${c.coin.symbol.toUpperCase()} (mapped): RSI=${cgData.rsi?.toFixed(0)} MACD=${cgData.macd?.histogram.toFixed(4) ?? 'null'} BB=${cgData.bb ? 'ok' : 'null'}`);
          } else {
            console.log(`[Binance] ${binanceSymbol}: no data + CG OHLC fallback failed`);
          }
        }
      } else {
        const spotSymbol = c.coin.symbol.toUpperCase() + "USDT";
        const spotData = await getBinanceRsiOnly(spotSymbol);
        if (spotData != null) {
          bd = spotData;
          console.log(`[Binance] ${spotSymbol}: spot RSI=${spotData.rsi?.toFixed(0)} MACD=${spotData.macd?.histogram.toFixed(4) ?? 'null'}`);
        } else {
          // Fallback CoinGecko OHLC — real candles for DEX-only tokens
          const cgData = await getCoinGeckoOhlcData(c.coin.id);
          if (cgData != null) {
            bd = cgData;
            console.log(`[CoinGecko OHLC] ${c.coin.symbol.toUpperCase()}: RSI=${cgData.rsi?.toFixed(0)} MACD=${cgData.macd?.histogram.toFixed(4) ?? 'null'} BB=${cgData.bb ? 'ok' : 'null'}`);
          } else {
            console.log(`[Binance] ${c.coin.symbol.toUpperCase()}: not available (no CG OHLC fallback)`);
          }
        }
      }

      const ls = scoreLong(c.coin, bd);
      const ss = scoreShort(c.coin, bd);
      enrichedMap.set(c.coin.id, {
        coin: c.coin,
        longScore: ls.score,
        shortScore: ss.score,
        longReasons: ls.reasons,
        shortReasons: ss.reasons,
        binanceData: bd,
      });
    }

    // 7. Insertion des signaux avec TP/SL
    // Seuls les coins enrichis (top3Long + top3Short) passent au scoring final
    const enriched = [...toEnrichMap.values()].map(c => enrichedMap.get(c.coin.id) ?? c);
    const btcCoin = coins.find(c => c.id === "bitcoin");
    const btcCurrentPrice = btcCoin?.current_price ?? 0;
    const btcTrend = computeBtcTrend(btcCurrentPrice);
    if (btcCurrentPrice === 0) {
      console.log(`[BTC FILTER] ⚠️ Prix BTC introuvable dans les coins — filtre désactivé (NEUTRAL)`);
    } else {
      console.log(`[BTC FILTER] Cycle n-1: $${btcTrend.prev.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Cycle n: $${btcTrend.curr.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Variation: ${btcTrend.pct >= 0 ? "+" : ""}${btcTrend.pct.toFixed(2)}% → ${btcTrend.trend}`);
    }

    const dedupCutoff = new Date(Date.now() - DEDUP_MINUTES * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - CONFLICT_MINUTES * 60 * 1000);

    for (const c of enriched) {
      const { coin, longScore, shortScore, longReasons, shortReasons, binanceData: bd } = c;

      if (BLACKLISTED_TOKENS.includes(coin.symbol.toUpperCase())) {
        console.log(`[V5] Blacklisted token skipped: ${coin.symbol.toUpperCase()}`);
        continue;
      }

      const price = coin.current_price.toString();
      const entryNum = coin.current_price;
      const rsi15m = bd?.rsi != null ? String(bd.rsi.toFixed(1)) : null;
      const fundingRate = bd?.fundingRate != null ? String(bd.fundingRate) : null;
      const oiChange = bd?.oiChange != null ? String(bd.oiChange.toFixed(2)) : null;

      // Filtres RSI Divergence
      const ch1h = coin.price_change_percentage_1h_in_currency;
      const rsiVal = bd?.rsi ?? null;

      const rsiDivBlockLong  = rsiVal != null && ch1h > 0 && rsiVal < 45;
      const rsiDivBlockShort = rsiVal != null && ch1h < 0 && rsiVal > 55;

      if (!bd?.ohlcCandles) {
        console.log(`[SCORING] ${coin.symbol.toUpperCase()} bloqué — aucune donnée OHLC disponible`);
        continue;
      }

      // LONG
      if (longScore >= MIN_SCORE && btcTrend.trend === "DOWN") {
        console.log(`[BTC FILTER] Signal LONG ${coin.symbol.toUpperCase()} bloqué - BTC ${btcTrend.pct.toFixed(2)}% sur 15min`);
      } else if (longScore >= MIN_SCORE && rsiDivBlockLong) {
        console.log(`[RSI DIVERGENCE] Signal LONG ${coin.symbol.toUpperCase()} bloqué — prix +${ch1h.toFixed(1)}% mais RSI=${rsiVal!.toFixed(0)}`);
      } else if (longScore >= MIN_SCORE) {
        if (rsiVal != null) console.log(`[RSI DIVERGENCE] LONG ${coin.symbol.toUpperCase()} — RSI=${rsiVal.toFixed(0)} change_1h=${ch1h.toFixed(1)}% → OK`);
        const [existing, conflicting] = await dbQuery(() => Promise.all([
          // Dedup LONG : bloquer si signal récent (< 120min) OU signal encore ouvert (non résolu)
          db.select().from(signalsTable)
            .where(and(
              eq(signalsTable.symbol, coin.symbol),
              eq(signalsTable.direction, "LONG"),
              or(gte(signalsTable.created_at, dedupCutoff), eq(signalsTable.resolved, false))
            ))
            .limit(1),
          // Conflit SHORT : bloquer si SHORT récent (< 2h) OU SHORT encore ouvert
          db.select().from(signalsTable)
            .where(and(
              eq(signalsTable.symbol, coin.symbol),
              eq(signalsTable.direction, "SHORT"),
              or(gte(signalsTable.created_at, twoHoursAgo), eq(signalsTable.resolved, false))
            ))
            .limit(1),
        ]));

        if (existing.length === 0 && conflicting.length === 0) {
          const now = new Date();
          const tpPrice = (entryNum * 1.04).toString();
          const slPrice = (entryNum * 0.98).toString();
          let savedToDB = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const [insertedLong] = await dbQuery(() =>
                db.insert(signalsTable).values({
                  coin_id: coin.id,
                  symbol: coin.symbol,
                  image: coin.image,
                  direction: "LONG",
                  entry_price: price,
                  signal_score: longScore,
                  created_at: now,
                  version: "v5",
                  rsi_15m: rsi15m,
                  funding_rate: fundingRate,
                  oi_change: oiChange,
                  reasons: longReasons.slice(0, 3).join(" | "),
                  change_1h: coin.price_change_percentage_1h_in_currency?.toFixed(2) ?? null,
                  change_24h: coin.price_change_percentage_24h_in_currency?.toFixed(2) ?? null,
                  tp_price: tpPrice,
                  sl_price: slPrice,
                }).returning({ id: signalsTable.id })
              );
              savedToDB = true;
              console.log(`[V5] ✅ LONG ${coin.symbol.toUpperCase()} saved to DB (id=${insertedLong.id})`);
              const verifyLong = await dbQuery(() =>
                db.select().from(signalsTable).where(eq(signalsTable.id, insertedLong.id)).limit(1)
              );
              if (verifyLong.length === 0) {
                console.error(`[DB] ❌ GHOST INSERT: LONG ${coin.symbol.toUpperCase()} inserted but not found!`);
                await sendTelegram(`🚨 DB GHOST: ${coin.symbol.toUpperCase()} manquant en DB`);
              }
              break;
            } catch (err: any) {
              const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || "unknown error";
              console.error(`[DB] ❌ Insert failed: ${errorMsg}`);
              console.error(`[DB] Full error:`, err);
              dbErrors.unshift({ ts: new Date().toISOString(), symbol: coin.symbol.toUpperCase(), direction: "LONG", error: errorMsg });
              if (dbErrors.length > 50) dbErrors.pop();
              if (attempt < 2) await sleep(2000);
            }
          }
          console.log(`[V5] Signal LONG ${coin.symbol.toUpperCase()} score=${longScore}/100 @ $${parseFloat(price).toFixed(4)} TP=$${parseFloat(tpPrice).toFixed(4)} SL=$${parseFloat(slPrice).toFixed(4)}`);
          const msg = formatSignalMessage(coin.symbol, "LONG", longScore, price, longReasons, now, bd?.rsi, bd?.fundingRate, bd?.oiChange, tpPrice, slPrice);
          await sendTelegram(savedToDB ? msg : msg + "\n⚠️ Non enregistré en DB");
        } else if (existing.length > 0) {
          console.log(`[V5] Dedup LONG ${coin.symbol.toUpperCase()} — signal récent ou encore ouvert (non résolu)`);
        } else {
          console.log(`[V5] Blocked LONG ${coin.symbol.toUpperCase()} — SHORT contradictoire récent ou encore ouvert`);
        }
      }

      // SHORT
      if (shortScore >= MIN_SCORE && btcTrend.trend === "UP") {
        console.log(`[BTC FILTER] Signal SHORT ${coin.symbol.toUpperCase()} bloqué - BTC +${btcTrend.pct.toFixed(2)}% sur 15min`);
      } else if (shortScore >= MIN_SCORE && rsiDivBlockShort) {
        console.log(`[RSI DIVERGENCE] Signal SHORT ${coin.symbol.toUpperCase()} bloqué — prix ${ch1h.toFixed(1)}% mais RSI=${rsiVal!.toFixed(0)}`);
      } else if (shortScore >= MIN_SCORE) {
        if (rsiVal != null) console.log(`[RSI DIVERGENCE] SHORT ${coin.symbol.toUpperCase()} — RSI=${rsiVal.toFixed(0)} change_1h=${ch1h.toFixed(1)}% → OK`);
        const [existing, conflicting] = await dbQuery(() => Promise.all([
          // Dedup SHORT : bloquer si signal récent (< 120min) OU signal encore ouvert (non résolu)
          db.select().from(signalsTable)
            .where(and(
              eq(signalsTable.symbol, coin.symbol),
              eq(signalsTable.direction, "SHORT"),
              or(gte(signalsTable.created_at, dedupCutoff), eq(signalsTable.resolved, false))
            ))
            .limit(1),
          // Conflit LONG : bloquer si LONG récent (< 2h) OU LONG encore ouvert
          db.select().from(signalsTable)
            .where(and(
              eq(signalsTable.symbol, coin.symbol),
              eq(signalsTable.direction, "LONG"),
              or(gte(signalsTable.created_at, twoHoursAgo), eq(signalsTable.resolved, false))
            ))
            .limit(1),
        ]));

        if (existing.length === 0 && conflicting.length === 0) {
          const now = new Date();
          const tpPrice = (entryNum * 0.96).toString();
          const slPrice = (entryNum * 1.02).toString();
          let savedToDB = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const [insertedShort] = await dbQuery(() =>
                db.insert(signalsTable).values({
                  coin_id: coin.id,
                  symbol: coin.symbol,
                  image: coin.image,
                  direction: "SHORT",
                  entry_price: price,
                  signal_score: shortScore,
                  created_at: now,
                  version: "v5",
                  rsi_15m: rsi15m,
                  funding_rate: fundingRate,
                  oi_change: oiChange,
                  reasons: shortReasons.slice(0, 3).join(" | "),
                  change_1h: coin.price_change_percentage_1h_in_currency?.toFixed(2) ?? null,
                  change_24h: coin.price_change_percentage_24h_in_currency?.toFixed(2) ?? null,
                  tp_price: tpPrice,
                  sl_price: slPrice,
                }).returning({ id: signalsTable.id })
              );
              savedToDB = true;
              console.log(`[V5] ✅ SHORT ${coin.symbol.toUpperCase()} saved to DB (id=${insertedShort.id})`);
              const verifyShort = await dbQuery(() =>
                db.select().from(signalsTable).where(eq(signalsTable.id, insertedShort.id)).limit(1)
              );
              if (verifyShort.length === 0) {
                console.error(`[DB] ❌ GHOST INSERT: SHORT ${coin.symbol.toUpperCase()} inserted but not found!`);
                await sendTelegram(`🚨 DB GHOST: ${coin.symbol.toUpperCase()} manquant en DB`);
              }
              break;
            } catch (err: any) {
              const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || "unknown error";
              console.error(`[DB] ❌ Insert failed: ${errorMsg}`);
              console.error(`[DB] Full error:`, err);
              dbErrors.unshift({ ts: new Date().toISOString(), symbol: coin.symbol.toUpperCase(), direction: "SHORT", error: errorMsg });
              if (dbErrors.length > 50) dbErrors.pop();
              if (attempt < 2) await sleep(2000);
            }
          }
          console.log(`[V5] Signal SHORT ${coin.symbol.toUpperCase()} score=${shortScore}/100 @ $${parseFloat(price).toFixed(4)} TP=$${parseFloat(tpPrice).toFixed(4)} SL=$${parseFloat(slPrice).toFixed(4)}`);
          const msg = formatSignalMessage(coin.symbol, "SHORT", shortScore, price, shortReasons, now, bd?.rsi, bd?.fundingRate, bd?.oiChange, tpPrice, slPrice);
          await sendTelegram(savedToDB ? msg : msg + "\n⚠️ Non enregistré en DB");
        } else if (existing.length > 0) {
          console.log(`[V5] Dedup SHORT ${coin.symbol.toUpperCase()} — signal récent ou encore ouvert (non résolu)`);
        } else {
          console.log(`[V5] Blocked SHORT ${coin.symbol.toUpperCase()} — LONG contradictoire récent ou encore ouvert`);
        }
      }
    }

    if (!statsEmittedThisCycle) {
      statsEmittedThisCycle = true;
      await runV3Stats();
    }

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log(`[V5] Cycle complete in ${elapsed}s — next in 5min`);
  } catch (err) {
    console.error("[CronJob] Erreur inattendue:", err);
  } finally {
    isRunning = false;
  }
}

async function checkDbHealth() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT COUNT(*) AS total FROM signals");
      const total = result.rows[0]?.total ?? "?";
      console.log(`[DB] HealthCheck ✅ — ${total} signaux en base`);
    } finally {
      client.release();
    }
  } catch (err: any) {
    const msg = err?.message || err?.toString() || "unknown error";
    console.error(`[DB] ❌ HealthCheck FAILED: ${msg}`);
    await sendTelegram(`🚨 <b>DB Health Check FAILED</b>\n${msg}`).catch(() => {});
  }
}

let cronStarted = false;
export function startCron() {
  console.log(`[CronJob] startCron() appelé — cronStarted=${cronStarted} PID=${process.pid}`);
  if (cronStarted) {
    console.warn("[CronJob] ⚠️ startCron() appelé plusieurs fois — IGNORÉ (double appel détecté)");
    return;
  }
  cronStarted = true;
  console.log("[CronJob] Démarrage — premier cycle dans 10s, puis toutes les 5 minutes");
  setTimeout(() => runCron(), 10_000);
  setInterval(() => runCron(), 5 * 60 * 1000);
  setTimeout(() => checkDbHealth(), 30_000);
  setInterval(() => checkDbHealth(), 10 * 60 * 1000);
  console.log("[DB] HealthCheck actif (toutes les 10min)");
}

export async function gracefulShutdown() {
  console.log("[CronJob] Shutdown gracieux — résolution des signaux expirés...");
  try {
    await resolveSignals();
    console.log("[CronJob] Shutdown terminé");
  } catch (err) {
    console.error("[CronJob] Erreur shutdown:", err);
  }
}
