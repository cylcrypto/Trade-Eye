import type { BinanceData } from "./binance.js";

const OHLC_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: BinanceData;
  timestamp: number;
}

const ohlcCache = new Map<string, CacheEntry>();

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < 26) return null;
  const ema = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    let val = data[0];
    for (let i = 1; i < data.length; i++)
      val = data[i] * k + val * (1 - k);
    return val;
  };
  const ema12 = ema(closes.slice(-26), 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  const signalLine = ema(
    closes.slice(-9).map((_, i) => {
      const e12 = ema(closes.slice(-(26 - i) || 1), 12);
      const e26 = ema(closes.slice(-(i + 26)), 26);
      return e12 - e26;
    }), 9
  );
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calcBollingerBands(closes: number[], period = 20): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b) / period;
  const std = Math.sqrt(
    slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period
  );
  return { upper: middle + 2 * std, middle, lower: middle - 2 * std };
}

export async function getCoinGeckoOhlcData(coinId: string): Promise<BinanceData | null> {
  const now = Date.now();
  const cached = ohlcCache.get(coinId);

  if (cached && now - cached.timestamp < OHLC_TTL_MS) {
    const ageMin = Math.round((now - cached.timestamp) / 60000);
    console.log(`[OHLC CACHE] ${coinId.toUpperCase()} — données en cache (${ageMin}min)`);
    return cached.data;
  }

  console.log(`[OHLC CACHE] ${coinId.toUpperCase()} — fetch frais`);

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;

    const raw = (await res.json()) as number[][];
    if (!Array.isArray(raw) || raw.length < 15) return null;

    const closes = raw.map((c) => c[4]);

    const data: BinanceData = {
      rsi: calcRSI(closes, 14),
      macd: calcMACD(closes),
      bb: calcBollingerBands(closes),
      volDivergence: null,
      lastClose: closes[closes.length - 1],
      oiChange: null,
      fundingRate: null,
      ohlcCandles: raw,
    };

    ohlcCache.set(coinId, { data, timestamp: now });
    return data;
  } catch {
    return null;
  }
}
