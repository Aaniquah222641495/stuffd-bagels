import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  eventDate: text("event_date").notNull(),
  hours: text("hours").notNull(),
  venue: text("venue").notNull(),
  subtitle: text("subtitle").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type Event = typeof events.$inferSelect;

