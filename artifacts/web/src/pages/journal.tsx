import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useState } from "react";
import { RefreshCw, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

type TelegramLog = {
  id: number;
  message: string;
  type: string;
  created_at: string;
};

type FilterType = "ALL" | "SIGNAL" | "RESULT" | "RECAP" | "SUMMARY" | "OTHER";

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  SIGNAL:  { label: "SIGNAL",  color: "#60a5fa", bg: "rgba(96,165,250,0.08)",  border: "rgba(96,165,250,0.3)"  },
  RESULT:  { label: "RESULT",  color: "#34d399", bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.3)"  },
  RECAP:   { label: "RECAP",   color: "#fbbf24", bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.3)"  },
  SUMMARY: { label: "RÉSUMÉ",  color: "#a78bfa", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.3)" },
  OTHER:   { label: "AUTRE",   color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.3)" },
};

const FILTERS: FilterType[] = ["ALL", "SIGNAL", "RESULT", "RECAP", "SUMMARY", "OTHER"];

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function fetchLogs(type: FilterType): Promise<TelegramLog[]> {
  const url = type === "ALL"
    ? `${BASE_URL}/api/signals/telegram-logs`
    : `${BASE_URL}/api/signals/telegram-logs?type=${type}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erreur API");
  return res.json();
}

function LogCard({ log }: { log: TelegramLog }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = TYPE_CONFIG[log.type] ?? TYPE_CONFIG["OTHER"];
  const lines = log.message.split("\n");
  const preview = lines.slice(0, 2).join(" ").replace(/<[^>]+>/g, "").slice(0, 80);
  const fullText = log.message.replace(/<b>/g, "").replace(/<\/b>/g, "").replace(/<[^>]+>/g, "");
  const date = format(new Date(log.created_at), "dd/MM HH:mm", { locale: fr });

  return (
    <div
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: cfg.color,
              background: `${cfg.color}18`,
              border: `1px solid ${cfg.border}`,
              padding: "1px 6px",
              borderRadius: 4,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {cfg.label}
          </span>
          <span
            className="font-mono text-muted-foreground truncate"
            style={{ fontSize: 11 }}
          >
            {preview}{preview.length >= 80 ? "…" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="font-mono text-muted-foreground" style={{ fontSize: 10 }}>
            {date}
          </span>
          {expanded
            ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
            : <ChevronDown className="h-3 w-3 text-muted-foreground" />
          }
        </div>
      </div>

      {expanded && (
        <pre
          className="font-mono mt-3 whitespace-pre-wrap break-words"
          style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.6 }}
        >
          {fullText}
        </pre>
      )}
    </div>
  );
}

export default function JournalPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("ALL");

  const { data: logs, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["telegram-logs", activeFilter],
    queryFn: () => fetchLogs(activeFilter),
    refetchInterval: 60_000,
  });

  const lastRefresh = dataUpdatedAt ? format(new Date(dataUpdatedAt), "HH:mm:ss") : "--:--:--";

  return (
    <Layout>
      <div className="space-y-4">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="font-display font-bold tracking-wider" style={{ fontSize: 13 }}>
              JOURNAL TELEGRAM
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground" style={{ fontSize: 10 }}>
              {lastRefresh}
            </span>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded text-xs hover:border-muted-foreground transition-all"
              style={{ minHeight: 32, touchAction: "manipulation" }}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => {
            const isActive = activeFilter === f;
            const cfg = f === "ALL" ? null : TYPE_CONFIG[f];
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: isActive
                    ? `1px solid ${cfg?.color ?? "hsl(var(--primary))"}`
                    : "1px solid hsl(var(--border))",
                  background: isActive
                    ? `${cfg?.bg ?? "hsla(var(--primary) / 0.1)"}`
                    : "transparent",
                  color: isActive
                    ? (cfg?.color ?? "hsl(var(--primary))")
                    : "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  touchAction: "manipulation",
                  minHeight: 32,
                }}
              >
                {f === "ALL" ? "TOUT" : (TYPE_CONFIG[f]?.label ?? f)}
              </button>
            );
          })}
        </div>

        {/* Count */}
        {logs && (
          <div className="text-muted-foreground font-mono" style={{ fontSize: 11 }}>
            {logs.length} message{logs.length !== 1 ? "s" : ""}
            {activeFilter !== "ALL" ? ` · filtre: ${activeFilter}` : ""}
          </div>
        )}

        {isLoading && (
          <div className="text-center text-muted-foreground py-12 font-mono" style={{ fontSize: 12 }}>
            Chargement...
          </div>
        )}

        {isError && (
          <div className="text-center py-12 font-mono" style={{ fontSize: 12, color: "#f87171" }}>
            Erreur de chargement
          </div>
        )}

        {!isLoading && !isError && logs?.length === 0 && (
          <div className="text-center text-muted-foreground py-12 font-mono" style={{ fontSize: 12 }}>
            Aucun message enregistré
          </div>
        )}

        {/* Log list */}
        <div className="space-y-2">
          {logs?.map(log => (
            <LogCard key={log.id} log={log} />
          ))}
        </div>

      </div>
    </Layout>
  );
}
