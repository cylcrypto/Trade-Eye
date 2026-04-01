import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  coin_id: text("coin_id").notNull(),
  symbol: text("symbol").notNull(),
  image: text("image").notNull(),
  direction: text("direction").notNull(),
  entry_price: text("entry_price").notNull(),
  signal_score: integer("signal_score").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  result: text("result"),
  exit_price: text("exit_price"),
  pct_change: text("pct_change"),
  pts: integer("pts"),
  version: text("version").default("v4"),
  funding_rate: text("funding_rate"),
  rsi_15m: text("rsi_15m"),
  oi_change: text("oi_change"),
  reasons: text("reasons"),
  change_1h: text("change_1h"),
  change_24h: text("change_24h"),
  tp_price: text("tp_price"),
  sl_price: text("sl_price"),
  updated_at: timestamp("updated_at", { withTimezone: true }),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;

export const telegramLogsTable = pgTable("telegram_logs", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  type: text("type").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TelegramLog = typeof telegramLogsTable.$inferSelect;
