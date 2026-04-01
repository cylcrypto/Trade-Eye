import { useGetSignalsPending } from "@workspace/api-client-react";
import type { Signal } from "@workspace/api-client-react/src/generated/api.schemas";
import { formatCurrency, cn } from "@/lib/utils";
import { differenceInMinutes, format } from "date-fns";
import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { Layout } from "@/components/layout";
import { useState, useEffect } from "react";

export default function SignalsPage() {
  const { data: pendingSignals, isLoading, dataUpdatedAt, refetch } = useGetSignalsPending({
    query: { refetchInterval: 90000 }
  });

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const bestLong = pendingSignals
    ?.filter(s => s.direction === "LONG")
    ?.sort((a, b) => b.signal_score - a.signal_score)[0];

  const bestShort = pendingSignals
    ?.filter(s => s.direction === "SHORT")
    ?.sort((a, b) => b.signal_score - a.signal_score)[0];

  const lastRefresh = dataUpdatedAt ? format(new Date(dataUpdatedAt), "HH:mm:ss") : "--:--:--";

  return (
    <Layout>
      <div className="space-y-4">

        {/* Risk Banner */}
        <div className="bg-warning/10 border border-warning/40 rounded-md p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning/80 leading-relaxed">
            Signaux algorithmiques. Pas de conseils financiers. Gérez votre risque.
          </p>
        </div>

        {/* Refresh row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Rafraîchi à <span className="font-mono text-foreground">{lastRefresh}</span></span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded text-xs hover:border-muted-foreground transition-all"
            style={{ minHeight: 32, touchAction: "manipulation" }}
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {/* Signal cards */}
        <div className="space-y-4">
          <SignalCard signal={bestLong} type="LONG" isLoading={isLoading} now={now} />
          <SignalCard signal={bestShort} type="SHORT" isLoading={isLoading} now={now} />
        </div>

        {/* Methodology */}
        <div className="border border-border bg-card rounded-md p-4 text-xs text-muted-foreground space-y-2">
          <div className="font-bold text-foreground font-display text-sm">V4 ENGINE</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-foreground font-bold mb-1">Sources</div>
              <ul className="space-y-0.5">
                <li>• CoinGecko top 500, vol &gt; $3M</li>
                <li>• Binance RSI 15m, OI, FR</li>
              </ul>
            </div>
            <div>
              <div className="text-foreground font-bold mb-1">Scoring (0-100)</div>
              <ul className="space-y-0.5">
                <li>• Momentum 15m: 40pts</li>
                <li>• Volume + Accél: 30pts</li>
                <li>• RSI + OI + FR: 30pts</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border/50 pt-2">
            Dédup 60min · Anti-conflit 2h · Résolution auto 45min
          </div>
        </div>

      </div>
    </Layout>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: "green" | "red" | "blue" | "gold" | "muted" }) {
  const colors = {
    green: "bg-primary/10 text-primary border-primary/30",
    red: "bg-destructive/10 text-destructive border-destructive/30",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    gold: "bg-warning/10 text-warning border-warning/30",
    muted: "bg-muted/10 text-muted-foreground border-border",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold border", colors[color])}>
      <span className="text-[9px] opacity-70">{label}</span>{value}
    </span>
  );
}

function SignalCard({ signal, type, isLoading, now }: { signal?: Signal; type: "LONG" | "SHORT"; isLoading: boolean; now: Date }) {
  const isLong = type === "LONG";
  const colorClass = isLong ? "text-primary" : "text-destructive";
  const bgClass = isLong ? "bg-primary" : "bg-destructive";
  const glowClass = isLong ? "border-primary/40" : "border-destructive/40";
  const Icon = isLong ? TrendingUp : TrendingDown;

  if (isLoading) {
    return (
      <div className="h-64 border border-border bg-card rounded-md animate-pulse" />
    );
  }

  if (!signal) {
    return (
      <div className="border border-border/50 border-dashed bg-card rounded-md p-6 flex flex-col items-center justify-center text-center gap-3">
        <div className={cn("h-12 w-12 rounded-full flex items-center justify-center border border-dashed", isLong ? "border-primary/30" : "border-destructive/30")}>
          <Icon className={cn("h-6 w-6 opacity-40", colorClass)} />
        </div>
        <div>
          <div className="font-display font-bold text-base">AUCUN SIGNAL {type}</div>
          <div className="text-xs text-muted-foreground mt-1">Score minimum 60/100 requis</div>
        </div>
      </div>
    );
  }

  const ageMinutes = differenceInMinutes(now, new Date(signal.created_at));
  let freshness = { label: "FRESH", color: "text-primary border-primary/40 bg-primary/10" as string };
  if (ageMinutes >= 60) freshness = { label: "STALE", color: "text-destructive border-destructive/40 bg-destructive/10" };
  else if (ageMinutes >= 30) freshness = { label: "WARM", color: "text-warning border-warning/40 bg-warning/10" };

  const ch1 = signal.change_1h != null ? parseFloat(signal.change_1h) : null;
  const ch24 = signal.change_24h != null ? parseFloat(signal.change_24h) : null;
  const rsi = signal.rsi_15m != null ? parseFloat(signal.rsi_15m) : null;
  const fr = signal.funding_rate != null ? parseFloat(signal.funding_rate) : null;
  const oi = signal.oi_change != null ? parseFloat(signal.oi_change) : null;
  const reasons = signal.reasons ? signal.reasons.split(" | ").filter(Boolean) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("relative border bg-card rounded-md p-4 overflow-hidden", glowClass)}
    >
      {/* Glow bg */}
      <div className={cn("absolute top-0 right-0 w-64 h-64 rounded-full blur-[80px] opacity-[0.07] pointer-events-none -translate-y-1/2 translate-x-1/2", bgClass)} />

      <div className="relative z-10 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <img src={signal.image} alt={signal.symbol} className="h-10 w-10 rounded-full bg-background border border-border" />
              <div className={cn("absolute -bottom-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center border-2 border-card", bgClass)}>
                <Icon className="h-2.5 w-2.5 text-background" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="font-display text-xl font-bold leading-none">{signal.symbol.toUpperCase()}</div>
              <div className={cn("text-[11px] font-bold tracking-widest", colorClass)}>SIGNAL {type} [V4]</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted-foreground">PRIX</div>
            <div className="font-mono text-sm font-bold">{formatCurrency(signal.entry_price)}</div>
          </div>
        </div>

        {/* Score bar */}
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">SCORE ALGORITHMIQUE</span>
            <span className={cn("font-bold font-mono", colorClass)}>{signal.signal_score}/100</span>
          </div>
          <div className="h-2.5 w-full bg-background rounded-full overflow-hidden border border-border">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${signal.signal_score}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={cn("h-full", bgClass)}
            />
          </div>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5">
          {ch1 != null && (
            <Chip label="1h" value={`${ch1 >= 0 ? "+" : ""}${ch1.toFixed(2)}%`} color={ch1 >= 0 ? "green" : "red"} />
          )}
          {ch24 != null && (
            <Chip label="24h" value={`${ch24 >= 0 ? "+" : ""}${ch24.toFixed(2)}%`} color={ch24 >= 0 ? "green" : "red"} />
          )}
          {rsi != null && (
            <Chip label="RSI" value={rsi.toFixed(0)} color={rsi < 30 ? "green" : rsi > 70 ? "red" : "muted"} />
          )}
          {fr != null && (
            <Chip label="FR" value={fr.toFixed(4)} color={fr < -0.001 ? "green" : fr > 0.002 ? "red" : "muted"} />
          )}
          {oi != null && (
            <Chip label="OI" value={`${oi >= 0 ? "+" : ""}${oi.toFixed(1)}%`} color={oi > 2 ? "green" : oi < -2 ? "red" : "muted"} />
          )}
        </div>

        {/* Reasons */}
        {reasons.length > 0 && (
          <div className="bg-background/50 rounded p-2.5 space-y-1">
            {reasons.map((r, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className={cn("mt-0.5", colorClass)}>›</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded border", freshness.color)}>
            <Clock className="h-2.5 w-2.5 inline mr-1" />
            {freshness.label} {ageMinutes}m
          </span>
          <span className="text-[11px] text-muted-foreground">
            Résolution dans {Math.max(0, 45 - ageMinutes)}min
          </span>
        </div>

      </div>
    </motion.div>
  );
}
