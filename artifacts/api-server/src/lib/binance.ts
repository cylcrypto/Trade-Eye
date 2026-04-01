interface Kline {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BinanceData {
  rsi: number | null;
  volDivergence: number | null;
  lastClose: number | null;
  oiChange: number | null;
  fundingRate: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bb: { upper: number; middle: number; lower: number } | null;
  ohlcCandles?: number[][] | null;
}

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

export async function getBinanceRsiOnly(symbol: string): Promise<BinanceData | null> {
  try {
    const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=30`;
    const klinesRes = await fetch(klinesUrl, { signal: AbortSignal.timeout(5000) });
    if (!klinesRes.ok) return null;
    const raw = (await klinesRes.json()) as unknown[][];
    const closes = raw.map((k) => parseFloat(k[4] as string));
    if (closes.length < 15) return null;
    return {
      rsi: calcRSI(closes, 14),
      macd: calcMACD(closes),
      bb: calcBollingerBands(closes),
      volDivergence: null,
      lastClose: closes[closes.length - 1],
      oiChange: null,
      fundingRate: null,
      ohlcCandles: raw as number[][],
    };
  } catch {
    return null;
  }
}

export async function getBinanceData(symbol: string): Promise<BinanceData> {
  const result: BinanceData = {
    rsi: null,
    volDivergence: null,
    lastClose: null,
    oiChange: null,
    fundingRate: null,
    macd: null,
    bb: null,
    ohlcCandles: null,
  };

  try {
    const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=30`;
    const klinesRes = await fetch(klinesUrl, { signal: AbortSignal.timeout(5000) });
    if (klinesRes.ok) {
      const raw = (await klinesRes.json()) as unknown[][];
      const klines: Kline[] = raw.map((k) => ({
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      }));
      if (klines.length >= 15) {
        const closes = klines.map((k) => k.close);
        result.rsi = calcRSI(closes, 14);
        result.macd = calcMACD(closes);
        result.bb = calcBollingerBands(closes);
        result.lastClose = closes[closes.length - 1];
        result.ohlcCandles = raw as number[][];
        const volumes = klines.slice(-15).map((k) => k.volume);
        const lastVol = volumes[volumes.length - 1];
        const avgVol = volumes.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
        result.volDivergence = avgVol > 0 ? lastVol / avgVol : null;
      }
    }
  } catch {
    console.log(`[Binance] ${symbol}: klines fetch error`);
  }

  try {
    const oiUrl = `https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=30m&limit=2`;
    const oiRes = await fetch(oiUrl, { signal: AbortSignal.timeout(5000) });
    if (oiRes.ok) {
      const oiData = (await oiRes.json()) as { sumOpenInterest: string }[];
      if (oiData.length >= 2) {
        const latest = parseFloat(oiData[oiData.length - 1].sumOpenInterest);
        const prev = parseFloat(oiData[0].sumOpenInterest);
        result.oiChange = prev > 0 ? ((latest - prev) / prev) * 100 : null;
      }
    }
  } catch {
    console.log(`[Binance] ${symbol}: OI fetch error`);
  }

  try {
    const frUrl = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const frRes = await fetch(frUrl, { signal: AbortSignal.timeout(5000) });
    if (frRes.ok) {
      const frData = (await frRes.json()) as { fundingRate: string }[];
      if (frData.length > 0) {
        result.fundingRate = parseFloat(frData[0].fundingRate);
      }
    }
  } catch {
    console.log(`[Binance] ${symbol}: funding rate fetch error`);
  }

  return result;
}
