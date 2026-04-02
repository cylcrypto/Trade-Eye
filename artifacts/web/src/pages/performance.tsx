import { useGetSignalsPerfo, useGetSignalsHistory, getExportSignalsUrl } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Layout } from "@/components/layout";
import { Download, TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export default function PerformancePage() {
  const { data: perfo, isLoading: loadingPerfo } = useGetSignalsPerfo();
  const { data: history, isLoading: loadingHistory } = useGetSignalsHistory();

  const brackets = perfo?.brackets ?? { "60-64": 0, "65-69": 0, "70-74": 0, "75+": 0 };

  const tp = perfo?.corrects ?? 0;
  const sl = perfo?.incorrects ?? 0;
  const pnlNet = (tp * 10) - (sl * 4);
  const totalResolved = tp + sl;
  const evPerTrade = totalResolved > 0 ? pnlNet / totalResolved : 0;
  const pnlPositive = pnlNet >= 0;

  return (
    <Layout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center border-b border-border pb-4">
          <div>
            <h2 className="text-xl font-display font-bold">PERFO 7J</h2>
            <p className="text-xs text-muted-foreground">Signaux V4 résolus uniquement</p>
          </div>
          <a
            href={getExportSignalsUrl()}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded text-xs font-bold hover:border-muted-foreground transition-all"
            style={{ minHeight: 44, touchAction: "manipulation" }}
          >
            <Download className="h-3.5 w-3.5" /> EXPORT TXT
          </a>
        </div>

        {/* PNL NET + win rate + counts */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-border bg-card rounded-md p-3 flex flex-col items-center justify-center">
            <div className="text-[10px] font-bold text-muted-foreground tracking-widest mb-2">PNL NET</div>
            {loadingPerfo ? (
              <div className="w-16 h-8 bg-muted rounded animate-pulse" />
            ) : (
              <div className={cn("text-2xl font-display font-bold leading-none", pnlPositive ? "text-primary" : "text-destructive")}>
                {pnlPositive ? "+" : ""}{pnlNet.toFixed(0)}€
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-1.5">
              {loadingPerfo ? "" : `${tp}TP / ${sl}SL`}
            </div>
          </div>

          <div className="border border-border bg-card rounded-md p-3 flex flex-col justify-center">
            <div className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1">WIN RATE</div>
            <div className={cn("text-3xl font-display font-bold", perfo && perfo.winRate >= 50 ? "text-primary" : "text-destructive")}>
              {loadingPerfo ? "--" : (perfo?.winRate || 0).toFixed(0)}
              <span className="text-lg">%</span>
            </div>
            <div className="mt-2 w-full bg-background h-1.5 rounded-full overflow-hidden">
              <div
                className={cn("h-full transition-all duration-700", perfo && perfo.winRate >= 50 ? "bg-primary" : "bg-destructive")}
                style={{ width: `${perfo?.winRate || 0}%` }}
              />
            </div>
          </div>

          <div className="border border-border bg-card rounded-md p-3 flex flex-col justify-center gap-2">
            <div className="flex justify-between text-xs">
              <span className="text-primary flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />OK</span>
              <span className="font-mono font-bold">{loadingPerfo ? "-" : perfo?.corrects ?? 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-warning flex items-center gap-1"><MinusCircle className="h-3 w-3" />NEU</span>
              <span className="font-mono font-bold">{loadingPerfo ? "-" : perfo?.neutres ?? 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-destructive flex items-center gap-1"><XCircle className="h-3 w-3" />KO</span>
              <span className="font-mono font-bold">{loadingPerfo ? "-" : perfo?.incorrects ?? 0}</span>
            </div>
          </div>
        </div>

        {/* LONG vs SHORT win rates + EV */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-primary/20 bg-card rounded-md p-3">
            <div className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-primary" /> LONG WR
            </div>
            <div className="text-2xl font-display font-bold text-primary">
              {loadingPerfo ? "--" : (perfo?.longWinRate || 0).toFixed(0)}%
            </div>
          </div>
          <div className="border border-destructive/20 bg-card rounded-md p-3">
            <div className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1 flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-destructive" /> SHORT WR
            </div>
            <div className="text-2xl font-display font-bold text-destructive">
              {loadingPerfo ? "--" : (perfo?.shortWinRate || 0).toFixed(0)}%
            </div>
          </div>
          <div className="border border-border bg-card rounded-md p-3">
            <div className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1">EV/TRADE</div>
            {loadingPerfo ? (
              <div className="h-7 bg-muted rounded animate-pulse w-12" />
            ) : (
              <div className={cn("text-2xl font-display font-bold", evPerTrade >= 0 ? "text-primary" : "text-destructive")}>
                {evPerTrade >= 0 ? "+" : ""}{evPerTrade.toFixed(2)}€
              </div>
            )}
          </div>
        </div>

        {/* Score brackets */}
        <div className="border border-border bg-card rounded-md overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-background/50">
            <div className="text-xs font-bold text-muted-foreground tracking-widest">PAR SCORE</div>
          </div>
          <div className="divide-y divide-border">
            {(["60-64", "65-69", "70-74", "75+"] as const).map(range => {
              const count = (brackets as Record<string, number>)[range] || 0;
              return (
                <div key={range} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{range}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-1.5 bg-background rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-700"
                        style={{ width: `${Math.min(100, count * 10)}%` }}
                      />
                    </div>
                    <span className="font-mono font-bold text-xs w-6 text-right">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* History */}
        <div>
          <h3 className="font-display font-bold text-sm mb-3 flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" /> HISTORIQUE
          </h3>

          <div className="border border-border bg-card rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[10px] text-muted-foreground uppercase bg-background/50 border-b border-border">
                  <tr>
                    <th className="px-3 py-2.5">Coin</th>
                    <th className="px-3 py-2.5">Dir</th>
                    <th className="px-3 py-2.5">Score</th>
                    <th className="px-3 py-2.5">Var%</th>
                    <th className="px-3 py-2.5">Pts</th>
                    <th className="px-3 py-2.5">Âge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingHistory ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 6 }).map((__, j) => (
                          <td key={j} className="px-3 py-3"><div className="h-3 bg-muted rounded w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : !history || history.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Aucun historique V4.
                      </td>
                    </tr>
                  ) : (
                    history.map(signal => {
                      const isLong = signal.direction === "LONG";
                      const isResolved = signal.resolved;
                      const pct = signal.pct_change ? parseFloat(signal.pct_change) : null;
                      const isCorrect = signal.result === "correct";
                      const isIncorrect = signal.result === "incorrect";

                      let resIcon = <span className="text-muted-foreground">➡️</span>;
                      if (isCorrect) resIcon = <span className="text-primary">✅</span>;
                      else if (isIncorrect) resIcon = <span className="text-destructive">❌</span>;

                      return (
                        <tr key={signal.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <img src={signal.image} alt={signal.symbol} className="w-4 h-4 rounded-full bg-background" />
                              <span className="font-bold font-display">{signal.symbol.toUpperCase()}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn("text-[10px] font-bold flex items-center gap-0.5", isLong ? "text-primary" : "text-destructive")}>
                              {isLong ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                              {signal.direction}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono">{signal.signal_score}</td>
                          <td className="px-3 py-2.5 font-mono">
                            {isResolved && pct != null ? (
                              <span className={cn(pct >= 0 ? "text-primary" : "text-destructive")}>
                                {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-warning text-[10px] animate-pulse">EN COURS</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {isResolved ? (
                              <div className="flex items-center gap-1">
                                {resIcon}
                                <span className={cn("text-[10px] font-bold", isCorrect ? "text-primary" : isIncorrect ? "text-destructive" : "text-warning")}>
                                  {signal.pts}/10
                                </span>
                              </div>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground text-[10px]">
                            {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true, locale: fr })}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
