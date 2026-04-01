import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { Activity, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

const NAV_ITEMS = [
  { path: "/", label: "SIGNAUX" },
  { path: "/perfo", label: "PERFO" },
  { path: "/top500", label: "TOP 500" },
  { path: "/journal", label: "JOURNAL" },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isError, isSuccess } = useHealthCheck({
    query: { refetchInterval: 30000, retry: false }
  });

  return (
    <div
      className="min-h-screen flex flex-col bg-background text-foreground terminal-scrollbar"
      style={{ overflowX: "hidden", width: "100%" }}
    >
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md" style={{ width: "100%" }}>
        <div style={{ maxWidth: "430px", width: "100%", margin: "0 auto" }}>
          <div className="flex items-center justify-between px-4 py-3 gap-3">

            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-primary/30 bg-primary/10 glow-primary">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <h1 className="font-display text-xl font-bold tracking-widest text-foreground text-glow">
                TRADEYE<span className="text-primary">.</span>
              </h1>
            </div>

            {/* Navigation */}
            <nav className="flex items-center" style={{ overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    style={{
                      minHeight: "48px",
                      fontSize: "10px",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 7px",
                      flexShrink: 0,
                      fontWeight: "bold",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      transition: "all 0.15s",
                      color: isActive ? "hsl(var(--primary))" : "#8090b0",
                      borderBottom: isActive ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                      background: isActive ? "hsla(var(--primary) / 0.05)" : "transparent",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {/* Server Status */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-border bg-card shrink-0" style={{ fontSize: "9px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {isError ? (
                <>
                  <WifiOff className="h-3 w-3 text-destructive animate-pulse" />
                  <span className="text-destructive hidden sm:inline">ERREUR</span>
                </>
              ) : isSuccess ? (
                <>
                  <Wifi className="h-3 w-3 text-primary" />
                  <span className="text-primary hidden sm:inline">CONNECTÉ</span>
                </>
              ) : (
                <>
                  <Activity className="h-3 w-3 text-warning animate-spin" />
                  <span className="text-warning hidden sm:inline">...</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: "430px", width: "100%", margin: "0 auto", padding: "16px", flex: 1, overflowX: "hidden" }}>
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 mt-auto">
        <div style={{ maxWidth: "430px", width: "100%", margin: "0 auto", padding: "0 16px" }}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: "10px" }}>
              <ShieldAlert className="h-3 w-3 shrink-0" />
              <span>Le trading de cryptos comporte un risque élevé de perte en capital.</span>
            </div>
            <div className="text-muted-foreground font-mono" style={{ fontSize: "10px" }}>
              TRADEYE V4 ENGINE © {new Date().getFullYear()}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
