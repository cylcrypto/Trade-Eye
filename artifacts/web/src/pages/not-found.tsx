import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Layout } from "@/components/layout";

export default function NotFound() {
  return (
    <Layout>
      <div className="min-h-[60vh] w-full flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-destructive/20 blur-3xl rounded-full" />
          <AlertCircle className="w-24 h-24 text-destructive relative z-10" />
        </div>
        <h1 className="text-6xl font-display font-bold text-foreground mb-4 tracking-tighter">404</h1>
        <p className="text-xl text-muted-foreground mb-8 font-mono">SIGNAL_NOT_FOUND</p>
        <Link
          href="/"
          className="px-6 py-3 border-2 border-primary text-primary font-bold tracking-widest uppercase hover:bg-primary hover:text-primary-foreground transition-all duration-300 glow-primary rounded-sm"
        >
          RETOUR AU TERMINAL
        </Link>
      </div>
    </Layout>
  );
}
