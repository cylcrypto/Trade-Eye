import { db } from "@workspace/db";
import { telegramLogsTable } from "@workspace/db/schema";

function classifyMessage(message: string): string {
  if (message.includes("SIGNAL")) return "SIGNAL";
  if (message.includes("TP ATTEINT") || message.includes("SL ATTEINT")) return "RESULT";
  if (message.includes("TRADES EN COURS")) return "RECAP";
  if (message.includes("Résumé journalier")) return "SUMMARY";
  return "OTHER";
}

export async function sendTelegram(message: string): Promise<boolean> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn(`[Telegram] Variables manquantes — BOT_TOKEN: ${!!BOT_TOKEN}, CHAT_ID: ${!!CHAT_ID}`);
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10000),
    });

    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      console.error(`[Telegram] Échec API: ${data.description ?? "unknown"} (chat_id=${CHAT_ID})`);
    } else {
      console.log(`[Telegram] ✓ sent`);
      db.insert(telegramLogsTable).values({
        message,
        type: classifyMessage(message),
      }).catch(() => {});
    }
    return data.ok === true;
  } catch (err) {
    console.error("[Telegram] Erreur fetch:", err);
    return false;
  }
}

export function fmtPrice(p: string | number): string {
  const n = typeof p === "string" ? parseFloat(p) : p;
  if (isNaN(n)) return "N/A";
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

function pad(n: number) { return String(n).padStart(2, "0"); }

export function formatSignalMessage(
  symbol: string,
  direction: string,
  score: number,
  price: string,
  reasons: string[],
  createdAt: Date,
  rsi?: number | null,
  fundingRate?: number | null,
  oiChange?: number | null,
  tpPrice?: string,
  slPrice?: string,
): string {
  const emoji = direction === "LONG" ? "🟢" : "🔴";
  const d = createdAt;
  const local = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  const dateStr = `${pad(local.getDate())}/${pad(local.getMonth() + 1)}/${local.getFullYear()} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
  const topReasons = reasons.slice(0, 3).map(r => `• ${r}`).join("\n");

  const rsiStr = rsi != null ? `RSI 15m: ${rsi.toFixed(0)}` : "";
  const frStr = fundingRate != null ? `FR: ${fundingRate.toFixed(4)}` : "";
  const oiStr = oiChange != null ? `OI: ${oiChange >= 0 ? "+" : ""}${oiChange.toFixed(1)}%` : "";
  const binanceLine = [rsiStr, frStr, oiStr].filter(Boolean).join(" | ");

  const tpPct = direction === "LONG" ? "+5%" : "-5%";
  const slPct = direction === "LONG" ? "-2%" : "+2%";
  const tpLine = tpPrice ? `🎯 TP: $${fmtPrice(tpPrice)} (${tpPct})` : "";
  const slLine = slPrice ? `🛑 SL: $${fmtPrice(slPrice)} (${slPct})` : "";

  return `${emoji} <b>SIGNAL ${direction} — ${symbol.toUpperCase()} [V5]</b>
Score: ${score}/100
Prix entrée: $${fmtPrice(price)}${binanceLine ? `\n${binanceLine}` : ""}${tpLine ? `\n${tpLine}` : ""}${slLine ? `\n${slLine}` : ""}
Raisons:
${topReasons}
📅 ${dateStr}
⏱ Sans limite`;
}

export function formatResultMessage(
  symbol: string,
  direction: string,
  entryPrice: string,
  exitPrice: string,
  pctChange: string,
  pts: number,
  isTP: boolean,
  durationMs: number,
): string {
  const rawPct = parseFloat(pctChange);
  const directedPct = direction === "LONG" ? rawPct : -rawPct;
  const sign = directedPct >= 0 ? "+" : "";
  const emoji = isTP ? "✅" : "❌";
  const label = isTP ? "TP ATTEINT" : "SL ATTEINT";

  const totalMin = Math.floor(durationMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  return `${emoji} <b>${label} — ${symbol.toUpperCase()} ${direction} [V5]</b>
Entrée: $${fmtPrice(entryPrice)} → Sortie: $${fmtPrice(exitPrice)}
${sign}${directedPct.toFixed(2)}% | Durée: ${durationStr}
Score: ${pts}/10 pts`;
}
