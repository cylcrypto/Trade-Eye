import { Router } from "express";
import { db } from "@workspace/db";
import { signalsTable, telegramLogsTable } from "@workspace/db/schema";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { sendTelegram } from "../lib/telegram.js";

const router = Router();

router.get("/signals/pending", async (req, res) => {
  try {
    const showAll = req.query.all === "1";
    const pending = await db
      .select()
      .from(signalsTable)
      .where(
        showAll
          ? eq(signalsTable.resolved, false)
          : and(eq(signalsTable.resolved, false), eq(signalsTable.version, "v4")),
      )
      .orderBy(desc(signalsTable.signal_score));
    res.json(pending);
  } catch (err) {
    console.error("[Route] /signals/pending error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/signals/history", async (req, res) => {
  try {
    const showAll = req.query.all === "1";
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const history = await db
      .select()
      .from(signalsTable)
      .where(
        showAll
          ? gte(signalsTable.created_at, since)
          : and(eq(signalsTable.version, "v4"), gte(signalsTable.created_at, since)),
      )
      .orderBy(desc(signalsTable.created_at))
      .limit(100);
    res.json(history);
  } catch (err) {
    console.error("[Route] /signals/history error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/signals/perfo", async (req, res) => {
  try {
    const showAll = req.query.all === "1";
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const resolved = await db
      .select()
      .from(signalsTable)
      .where(
        showAll
          ? and(eq(signalsTable.resolved, true), gte(signalsTable.created_at, since))
          : and(
              eq(signalsTable.resolved, true),
              eq(signalsTable.version, "v4"),
              gte(signalsTable.created_at, since),
            ),
      );

    let corrects = 0;
    let incorrects = 0;
    let neutres = 0;
    let longWins = 0;
    let longTotal = 0;
    let shortWins = 0;
    let shortTotal = 0;

    const brackets: Record<string, number> = {
      "60-64": 0,
      "65-69": 0,
      "70-74": 0,
      "75+": 0,
    };

    for (const s of resolved) {
      if (s.result === "correct") {
        corrects++;
        if (s.direction === "LONG") longWins++;
        else shortWins++;
      } else if (s.result === "incorrect") {
        incorrects++;
      } else {
        neutres++;
      }

      if (s.direction === "LONG") longTotal++;
      else shortTotal++;

      const b =
        s.signal_score >= 75
          ? "75+"
          : s.signal_score >= 70
            ? "70-74"
            : s.signal_score >= 65
              ? "65-69"
              : "60-64";
      brackets[b] = (brackets[b] || 0) + 1;
    }

    const total = corrects + incorrects + neutres;
    const winRate = total > 0 ? (corrects / total) * 100 : 0;
    const longWinRate = longTotal > 0 ? (longWins / longTotal) * 100 : 0;
    const shortWinRate = shortTotal > 0 ? (shortWins / shortTotal) * 100 : 0;
    const score7d = total > 0 ? Math.min(10, (winRate / 100) * 10 + (total / 20)) : 0;

    res.json({
      corrects,
      incorrects,
      neutres,
      total,
      score7d: Math.round(score7d * 10) / 10,
      winRate: Math.round(winRate * 10) / 10,
      longWinRate: Math.round(longWinRate * 10) / 10,
      shortWinRate: Math.round(shortWinRate * 10) / 10,
      brackets,
    });
  } catch (err) {
    console.error("[Route] /signals/perfo error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/signals/export", async (req, res) => {
  try {
    const showAll = req.query.all === "1";
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const signals = await db
      .select()
      .from(signalsTable)
      .where(
        showAll
          ? gte(signalsTable.created_at, since)
          : and(eq(signalsTable.version, "v4"), gte(signalsTable.created_at, since)),
      )
      .orderBy(desc(signalsTable.created_at));

    const lines: string[] = [];
    lines.push("=== TRADEYE V4 SIGNAL EXPORT ===");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    for (const s of signals) {
      lines.push(`[${s.created_at}] ${s.direction} ${s.symbol.toUpperCase()} score=${s.signal_score} entry=${s.entry_price} resolved=${s.resolved} result=${s.result ?? "pending"} pct=${s.pct_change ?? "N/A"}`);
    }

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="tradeye-signals-${Date.now()}.txt"`);
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("[Route] /signals/export error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/signals/telegram-logs", async (req, res) => {
  try {
    const type = req.query.type as string | undefined;
    const logs = await db
      .select()
      .from(telegramLogsTable)
      .where(type ? eq(telegramLogsTable.type, type) : undefined)
      .orderBy(desc(telegramLogsTable.created_at))
      .limit(100);
    res.json(logs);
  } catch (err) {
    console.error("[Route] /signals/telegram-logs error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.post("/signals/import", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== "TRADEYE_ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const signals = req.body as typeof signalsTable.$inferInsert[];
    if (!Array.isArray(signals) || signals.length === 0) {
      return res.status(400).json({ error: "Bad request" });
    }
    const inserted = await db.insert(signalsTable).values(signals).returning();
    res.json({ inserted: inserted.length });
  } catch (err) {
    console.error("[Route] /signals/import error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/test-telegram", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return res.json({ success: false, message: `Variables manquantes: BOT_TOKEN=${!!token}, CHAT_ID=${!!chatId}` });
    }
    const ok = await sendTelegram("🧪 <b>TRADEYE TEST</b>\nConnexion Telegram OK ✅");
    res.json({ success: ok, message: ok ? "Message envoyé" : "Échec envoi" });
  } catch (err) {
    res.json({ success: false, message: String(err) });
  }
});

export default router;
