import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function runV3Stats(): Promise<void> {
  try {
    const data = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.version, "v5"));

    if (data.length === 0) {
      console.log("=== V5 STATS === Pas encore de signaux V5 résolus");
      return;
    }

    const brackets: Record<string, boolean[]> = {
      "60-64": [],
      "65-69": [],
      "70-74": [],
      "75+": [],
    };

    data.forEach((s) => {
      const b =
        s.signal_score >= 75
          ? "75+"
          : s.signal_score >= 70
            ? "70-74"
            : s.signal_score >= 65
              ? "65-69"
              : "60-64";
      brackets[b].push(s.result === "correct");
    });

    const bracketStats: Record<string, string> = {};
    Object.keys(brackets).forEach((b) => {
      const wins = brackets[b].filter((w) => w).length;
      const total = brackets[b].length;
      bracketStats[b] =
        total > 0 ? `${((wins / total) * 100).toFixed(1)}% (${wins}/${total})` : "—";
    });

    let totalPnL = 0;
    let resolved = 0;
    data.forEach((s) => {
      if (s.result === "correct" || s.result === "incorrect") {
        const pnl = parseFloat(s.pct_change ?? "0");
        totalPnL += pnl;
        resolved++;
      }
    });
    const ev = resolved > 0 ? (totalPnL / resolved).toFixed(3) + "%" : "0%";

    const tokenStats: Record<string, { wins: number; total: number }> = {};
    data.forEach((s) => {
      if (!tokenStats[s.symbol]) tokenStats[s.symbol] = { wins: 0, total: 0 };
      if (s.result === "correct") tokenStats[s.symbol].wins++;
      if (s.result === "correct" || s.result === "incorrect") {
        tokenStats[s.symbol].total++;
      }
    });

    const blacklist = Object.keys(tokenStats)
      .filter(
        (t) =>
          tokenStats[t].total >= 8 &&
          tokenStats[t].wins / tokenStats[t].total < 0.52,
      )
      .sort(
        (a, b) =>
          tokenStats[a].wins / tokenStats[a].total -
          tokenStats[b].wins / tokenStats[b].total,
      );

    let winScores = 0, winCount = 0;
    let lossScores = 0, lossCount = 0;
    data.forEach((s) => {
      if (s.result === "correct") {
        winScores += s.signal_score;
        winCount++;
      } else if (s.result === "incorrect") {
        lossScores += s.signal_score;
        lossCount++;
      }
    });
    const scoreImpact =
      winCount > 0 && lossCount > 0
        ? (winScores / winCount - lossScores / lossCount).toFixed(2)
        : "0";

    console.log("=== V5 STATS ===");
    console.log("Winrate par bracket:", JSON.stringify(bracketStats));
    console.log(`EV réel (moy pct/trade): ${ev} (${resolved} signaux résolus)`);
    console.log(
      "Blacklist dynamique:",
      blacklist.length > 0 ? blacklist.join(", ") : "Aucun token toxique",
    );
    console.log(`Score moyen wins vs losses: ${scoreImpact} pts`);
    console.log(
      "Recommandation:",
      blacklist.length > 0
        ? `Envisager blacklist: ${blacklist.join(", ")}`
        : "Algo stable — continuer",
    );
  } catch (err) {
    console.warn("[V5Stats] Erreur analyse:", err instanceof Error ? err.message : err);
  }
}
