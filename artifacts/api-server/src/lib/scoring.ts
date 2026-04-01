import type { BinanceData } from "./binance.js";

export interface CoinData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_1h_in_currency: number;
  price_change_percentage_24h_in_currency: number;
  total_volume: number;
}

export interface ScoreResult {
  score: number;
  direction: "LONG" | "SHORT";
  reasons: string[];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function calculate15minMomentum(ohlc: number[][] | null | undefined, symbol: string, silent = false): { pct: number; label: string } {
  if (!ohlc || ohlc.length < 2) {
    return { pct: 0, label: 'NO_DATA' };
  }
  const prevClose = parseFloat(String(ohlc[ohlc.length - 2][4]));
  const currentClose = parseFloat(String(ohlc[ohlc.length - 1][4]));
  if (!prevClose || !currentClose || prevClose === 0) return { pct: 0, label: 'NO_DATA' };

  const pct = ((currentClose - prevClose) / prevClose) * 100;
  let label = 'NEUTRAL';
  if (pct > 3)          label = 'TOO_STRONG_UP';
  else if (pct >= 0.5)  label = 'GOOD_LONG';
  else if (pct >= -0.5) label = 'RANGE';
  else if (pct <= -3)   label = 'TOO_STRONG_DOWN';
  else                  label = 'GOOD_SHORT';

  if (!silent) console.log(`[MOMENTUM 15min] ${symbol} | pct=${pct.toFixed(2)}% | label=${label}`);
  return { pct, label };
}

export function scoreLong(coin: CoinData, binance?: BinanceData): ScoreResult {
  const { price_change_percentage_1h_in_currency: ch1h, price_change_percentage_24h_in_currency: ch24h, total_volume: vol } = coin;
  const reasons: string[] = [];
  let score = 0;

  const mom15 = calculate15minMomentum(binance?.ohlcCandles, coin.symbol?.toUpperCase() || 'UNKNOWN');
  if (mom15.label === 'GOOD_LONG') {
    score += 40;
    reasons.push(`Momentum 15min +${mom15.pct.toFixed(1)}% (bon setup LONG)`);
  } else if (mom15.label === 'RANGE') {
    score += 20;
    reasons.push(`Momentum 15min range ${mom15.pct.toFixed(1)}%`);
  } else if (mom15.label === 'GOOD_SHORT' || mom15.label === 'TOO_STRONG_DOWN') {
    score -= 20;
    reasons.push(`Momentum 15min baissier ${mom15.pct.toFixed(1)}%`);
  } else if (mom15.label === 'NO_DATA') {
    if (ch1h > 3) {
      reasons.push(`Momentum 1h +${ch1h.toFixed(2)}% → move trop avancé (fallback)`);
    } else if (ch1h < -3) {
      reasons.push(`Momentum 1h ${ch1h.toFixed(2)}% → move trop avancé (fallback)`);
    } else if (ch1h >= 0.4 && ch1h <= 2.5) {
      score += 40;
      reasons.push(`Momentum 1h +${ch1h.toFixed(2)}% bon setup LONG (fallback)`);
    } else if (ch1h <= -0.4 && ch1h >= -2.5) {
      score -= 20;
      reasons.push(`Momentum 1h ${ch1h.toFixed(2)}% bon setup SHORT (fallback)`);
    } else {
      score += 20;
      reasons.push(`Momentum 1h neutre (fallback)`);
    }
  }

  if (ch24h < -2 && ch1h > 1) {
    score += 15;
    reasons.push(`Retournement haussier (24h${ch24h.toFixed(1)}% / 1h+${ch1h.toFixed(1)}%)`);
  } else if (ch24h > 0 && ch1h > 0) {
    const pts = clamp((ch24h / 10) * 15, 0, 15);
    score += pts;
    if (pts > 0) reasons.push(`Tendance 24h positive +${ch24h.toFixed(1)}%`);
  }

  const volRatio = vol / 5_000_000;
  const volPts = clamp((volRatio / 0.4) * 20, 0, 20);
  score += volPts;
  if (volPts > 0) reasons.push(`Volume fort ($${(vol / 1e6).toFixed(0)}M)`);

  const ch6hCapped = Math.max(-15, Math.min(15, ch24h / 4));
  const avgHourly = ch6hCapped / 6;
  if (ch1h > avgHourly * 2) {
    score += 10;
    reasons.push(`Accélération haussière (1h vs moyenne horaire)`);
  }

  if (binance?.rsi != null) {
    if (binance.rsi < 30) {
      score += 10;
      reasons.push(`RSI survendu ${binance.rsi.toFixed(0)}`);
    } else if (binance.rsi > 70) {
      score -= 10;
      reasons.push(`RSI suracheté ${binance.rsi.toFixed(0)}`);
    }
  }

  if (binance?.macd != null) {
    if (binance.macd.histogram > 0.001) {
      score += 15;
      reasons.push(`MACD haussier (+${binance.macd.histogram.toFixed(4)})`);
    } else if (binance.macd.histogram < -0.001) {
      score -= 15;
      reasons.push(`MACD baissier (${binance.macd.histogram.toFixed(4)})`);
    }
  }

  if (binance?.bb != null && binance.bb.lower > 0) {
    const cp = binance.lastClose ?? coin.current_price;
    if (cp > 0 && cp <= binance.bb.lower * 1.005) {
      score += 15;
      reasons.push(`Prix proche BB basse (signal LONG fort)`);
    } else if (cp >= binance.bb.upper * 0.995) {
      score -= 15;
      reasons.push(`Prix proche BB haute (défavorable LONG)`);
    }
  }

  if (binance?.volDivergence != null) {
    if (binance.volDivergence > 2 && ch1h > 0) {
      score += 10;
      reasons.push(`Divergence volume haussière (${binance.volDivergence.toFixed(1)}x)`);
    } else if (binance.volDivergence < 0.5 && ch1h > 0) {
      score -= 8;
    }
  }

  if (binance?.oiChange != null && binance.oiChange > 0 && ch1h > 0) {
    score += 10;
    reasons.push(`Open Interest en hausse (+${binance.oiChange.toFixed(1)}%)`);
  }

  if (binance?.fundingRate != null) {
    if (binance.fundingRate < -0.001) {
      score += 10;
      reasons.push(`Funding Rate négatif (squeeze short possible)`);
    } else if (binance.fundingRate > 0.002) {
      score -= 8;
    }
  }

  if (ch24h > 20) {
    score -= 20;
    reasons.push(`Pénalité pump excessif (24h +${ch24h.toFixed(0)}%)`);
  } else if (ch24h > 15 && ch1h < 0.5) {
    score -= 10;
  }

  return { score: Math.round(clamp(score, 0, 85)), direction: "LONG", reasons };
}

export function scoreShort(coin: CoinData, binance?: BinanceData): ScoreResult {
  const { price_change_percentage_1h_in_currency: ch1h, price_change_percentage_24h_in_currency: ch24h, total_volume: vol } = coin;
  const reasons: string[] = [];
  let score = 0;

  const mom15 = calculate15minMomentum(binance?.ohlcCandles, coin.symbol?.toUpperCase() || 'UNKNOWN', true);
  if (mom15.label === 'GOOD_SHORT') {
    score += 40;
    reasons.push(`Momentum 15min ${mom15.pct.toFixed(1)}% (bon setup SHORT)`);
  } else if (mom15.label === 'RANGE') {
    score += 20;
    reasons.push(`Momentum 15min range ${mom15.pct.toFixed(1)}%`);
  } else if (mom15.label === 'GOOD_LONG' || mom15.label === 'TOO_STRONG_UP') {
    score -= 20;
    reasons.push(`Momentum 15min haussier (défavorable SHORT) +${mom15.pct.toFixed(1)}%`);
  } else if (mom15.label === 'NO_DATA') {
    if (ch1h < -3) {
      reasons.push(`Momentum 1h ${ch1h.toFixed(2)}% → move trop avancé (fallback)`);
    } else if (ch1h > 3) {
      reasons.push(`Momentum 1h +${ch1h.toFixed(2)}% → move trop avancé (fallback)`);
    } else if (ch1h <= -0.4 && ch1h >= -2.5) {
      score += 40;
      reasons.push(`Momentum 1h ${ch1h.toFixed(2)}% bon setup SHORT (fallback)`);
    } else if (ch1h >= 0.4 && ch1h <= 2.5) {
      score -= 20;
      reasons.push(`Momentum 1h +${ch1h.toFixed(2)}% bon setup LONG (fallback)`);
    } else {
      score += 20;
      reasons.push(`Momentum 1h neutre (fallback)`);
    }
  }

  if (ch24h > 3 && ch1h < -1) {
    score += 15;
    reasons.push(`Retournement baissier (24h+${ch24h.toFixed(1)}% / 1h${ch1h.toFixed(1)}%)`);
  } else if (ch24h < -3 && ch1h < 0) {
    const pts = clamp((Math.abs(ch24h) / 10) * 15, 0, 15);
    score += pts;
    if (pts > 0) reasons.push(`Tendance 24h négative ${ch24h.toFixed(1)}%`);
  }

  if (ch1h < 0) {
    const volRatio = vol / 5_000_000;
    const pts = clamp((volRatio / 0.4) * 20, 0, 20);
    score += pts;
    if (pts > 0) reasons.push(`Volume vendeur élevé ($${(vol / 1e6).toFixed(0)}M)`);
  }

  const ch6hCapped = Math.max(-15, Math.min(15, ch24h / 4));
  const avgHourly = ch6hCapped / 6;
  if (ch1h < 0 && ch1h < avgHourly * 2) {
    score += 10;
    reasons.push(`Accélération baissière`);
  }

  if (binance?.rsi != null) {
    if (binance.rsi > 70) {
      score += 10;
      reasons.push(`RSI suracheté ${binance.rsi.toFixed(0)}`);
    } else if (binance.rsi < 30) {
      score -= 10;
    }
  }

  if (binance?.macd != null) {
    if (binance.macd.histogram < -0.001) {
      score += 15;
      reasons.push(`MACD baissier (${binance.macd.histogram.toFixed(4)})`);
    } else if (binance.macd.histogram > 0.001) {
      score -= 15;
      reasons.push(`MACD haussier (défavorable SHORT)`);
    }
  }

  if (binance?.bb != null && binance.bb.upper > 0) {
    const cp = binance.lastClose ?? coin.current_price;
    if (cp > 0 && cp >= binance.bb.upper * 0.995) {
      score += 15;
      reasons.push(`Prix proche BB haute (signal SHORT fort)`);
    } else if (cp <= binance.bb.lower * 1.005) {
      score -= 15;
      reasons.push(`Prix proche BB basse (défavorable SHORT)`);
    }
  }

  if (binance?.volDivergence != null) {
    if (binance.volDivergence > 2 && ch1h < 0) {
      score += 10;
      reasons.push(`Divergence volume baissière (${binance.volDivergence.toFixed(1)}x)`);
    } else if (binance.volDivergence < 0.5 && ch1h < 0) {
      score -= 8;
    }
  }

  if (binance?.oiChange != null && binance.oiChange > 0 && ch1h < 0) {
    score += 10;
    reasons.push(`Open Interest en hausse avec prix en baisse`);
  }

  if (binance?.fundingRate != null) {
    if (binance.fundingRate > 0.002) {
      score += 10;
      reasons.push(`Funding Rate élevé (squeeze long possible)`);
    } else if (binance.fundingRate < -0.001) {
      score -= 8;
    }
  }

  if (ch24h < -20) {
    score -= 20;
    reasons.push(`Pénalité dump excessif (24h ${ch24h.toFixed(0)}%)`);
  } else if (ch24h < -15 && ch1h < -3) {
    score -= 12;
  }

  return { score: Math.round(clamp(score, 0, 85)), direction: "SHORT", reasons };
}
