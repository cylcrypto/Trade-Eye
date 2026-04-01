import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { pool } from "@workspace/db";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id SERIAL PRIMARY KEY,
        coin_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        image TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price TEXT NOT NULL,
        signal_score INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        result TEXT,
        exit_price TEXT,
        pct_change TEXT,
        pts INTEGER,
        version TEXT DEFAULT 'v4',
        funding_rate TEXT,
        rsi_15m TEXT,
        oi_change TEXT,
        reasons TEXT,
        change_1h TEXT,
        change_24h TEXT,
        tp_price TEXT,
        sl_price TEXT,
        updated_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_logs (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log("[DB] Tables initialized");
  } finally {
    client.release();
  }
}

export default app;
