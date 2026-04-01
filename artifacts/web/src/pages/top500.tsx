import { useState } from "react";
import { useTop500Coins } from "@/hooks/use-coingecko";
import { Layout } from "@/components/layout";
import { formatCurrency, cn } from "@/lib/utils";
import { Search, Filter, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type FilterType = "ALL" | "UP" | "DOWN";
type SortColumn = "rank" | "prix" | "1h" | "24h";
type SortDir = "asc" | "desc";

function SortIcon({ column, sortColumn, sortDir }: { column: SortColumn; sortColumn: SortColumn; sortDir: SortDir }) {
  if (sortColumn !== column) return <ArrowUpDown className="inline-block ml-1 h-3 w-3 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="inline-block ml-1 h-3 w-3 text-primary" />
    : <ArrowDown className="inline-block ml-1 h-3 w-3 text-primary" />;
}

export default function Top500Page() {
  const { data: coins, isLoading, isError, error } = useTop500Coins();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [sortColumn, setSortColumn] = useState<SortColumn>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir(col === "rank" ? "asc" : "desc");
    }
  }

  const filteredCoins = coins
    ?.filter(coin => {
      const matchesSearch =
        coin.symbol.toLowerCase().includes(search.toLowerCase()) ||
        coin.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;
      if (filter === "UP") return coin.price_change_percentage_1h_in_currency > 0;
      if (filter === "DOWN") return coin.price_change_percentage_1h_in_currency < 0;
      return true;
    })
    .sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortColumn) {
        case "rank":  aVal = a.market_cap_rank; bVal = b.market_cap_rank; break;
        case "prix":  aVal = a.current_price; bVal = b.current_price; break;
        case "1h":    aVal = a.price_change_percentage_1h_in_currency || 0; bVal = b.price_change_percentage_1h_in_currency || 0; break;
        case "24h":   aVal = a.price_change_percentage_24h_in_currency || 0; bVal = b.price_change_percentage_24h_in_currency || 0; break;
        default:      return 0;
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

  const thClass = "px-2 py-3 font-bold cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap";

  return (
    <Layout>
      <div className="space-y-4">

        {/* Toolbar */}
        <div className="flex flex-col gap-3">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher symbole ou nom..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-card border border-border focus:border-primary rounded-md py-2 pl-10 pr-4 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="flex items-center gap-2 border border-border p-1 rounded-md bg-card">
            <Filter className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />
            <div className="h-4 w-[1px] bg-border mx-1" />
            {(["ALL", "UP", "DOWN"] as FilterType[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1 text-xs font-bold uppercase rounded transition-colors flex-1",
                  filter === f
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                style={{ minHeight: 32 }}
              >
                {f === "ALL" ? "TOUT" : f === "UP" ? "↑ HAUSSE" : "↓ BAISSE"}
              </button>
            ))}
          </div>
        </div>

        {/* Error State */}
        {isError && (
          <div className="bg-destructive/10 border border-destructive/50 text-destructive p-4 rounded-md flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-bold">Erreur API CoinGecko: {(error as Error).message}</span>
          </div>
        )}

        {/* Table */}
        <div className="border border-border bg-card rounded-md overflow-x-auto min-h-[500px]">
          <table style={{ tableLayout: "fixed", width: "100%" }} className="text-xs text-left">
            <colgroup>
              <col style={{ width: "40px" }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "56px" }} />
              <col style={{ width: "56px" }} />
              <col style={{ width: "32px" }} />
            </colgroup>
            <thead className="text-xs text-muted-foreground uppercase bg-background/50 border-b border-border sticky top-0 z-10 backdrop-blur-md">
              <tr>
                <th className={cn(thClass, "text-center")} onClick={() => handleSort("rank")}>
                  # <SortIcon column="rank" sortColumn={sortColumn} sortDir={sortDir} />
                </th>
                <th className={thClass}>Actif</th>
                <th className={cn(thClass, "text-right")} onClick={() => handleSort("prix")}>
                  Prix <SortIcon column="prix" sortColumn={sortColumn} sortDir={sortDir} />
                </th>
                <th className={cn(thClass, "text-right")} onClick={() => handleSort("1h")}>
                  1h <SortIcon column="1h" sortColumn={sortColumn} sortDir={sortDir} />
                </th>
                <th className={cn(thClass, "text-right")} onClick={() => handleSort("24h")}>
                  24h <SortIcon column="24h" sortColumn={sortColumn} sortDir={sortDir} />
                </th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-2 py-3"><div className="h-4 w-5 bg-muted rounded mx-auto" /></td>
                    <td className="px-2 py-3"><div className="flex items-center gap-2"><div className="h-5 w-5 rounded-full bg-muted shrink-0" /><div className="h-4 w-16 bg-muted rounded" /></div></td>
                    <td className="px-2 py-3"><div className="h-4 w-14 bg-muted rounded ml-auto" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-10 bg-muted rounded ml-auto" /></td>
                    <td className="px-2 py-3"><div className="h-4 w-10 bg-muted rounded ml-auto" /></td>
                    <td className="px-2 py-3" />
                  </tr>
                ))
              ) : filteredCoins?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    Aucun résultat trouvé.
                  </td>
                </tr>
              ) : (
                filteredCoins?.map((coin) => {
                  const ch1h = coin.price_change_percentage_1h_in_currency || 0;
                  const ch24h = coin.price_change_percentage_24h_in_currency || 0;
                  let dotColor = "bg-muted";
                  if (ch1h > 1.5) dotColor = "bg-primary";
                  else if (ch1h < -1.5) dotColor = "bg-destructive";

                  return (
                    <tr key={coin.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-2 py-2.5 font-mono text-muted-foreground text-center text-[10px]">
                        {coin.market_cap_rank}
                      </td>
                      <td className="px-2 py-2.5" style={{ overflow: "hidden" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={coin.image} alt={coin.name} className="w-5 h-5 rounded-full bg-background shrink-0" loading="lazy" />
                          <span className="font-display font-bold truncate">{coin.symbol.toUpperCase()}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 font-mono font-bold text-right" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatCurrency(coin.current_price)}
                      </td>
                      <td className="px-2 py-2.5 font-mono text-right">
                        <span className={cn(ch1h > 0 ? "text-primary" : ch1h < 0 ? "text-destructive" : "text-muted-foreground")}>
                          {ch1h > 0 ? "+" : ""}{ch1h.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-right">
                        <span className={cn(ch24h > 0 ? "text-primary/70" : ch24h < 0 ? "text-destructive/70" : "text-muted-foreground")}>
                          {ch24h > 0 ? "+" : ""}{ch24h.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className={cn("w-2 h-2 rounded-full mx-auto", dotColor)} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </Layout>
  );
}
