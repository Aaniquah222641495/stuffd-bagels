import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settings, events } from "@workspace/db";
import { sql, eq, asc } from "drizzle-orm";
import { getAvailability } from "./availability";
import crypto from "node:crypto";

const router = Router();

function requirePassword(req: Request, res: Response): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: "ADMIN_PASSWORD env var not configured" });
    return false;
  }
  const provided = req.headers["x-admin-password"];
  if (provided !== adminPassword) {
    res.status(401).json({ error: "Invalid password" });
    return false;
  }
  return true;
}

async function upsertSetting(key: string, value: string) {
  await db.execute(sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
  `);
}

// ─── Availability ────────────────────────────────────────────

router.get("/admin/availability", async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    const data = await getAvailability();
    res.json(data);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

router.post("/admin/availability", async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    const { ordersEnabled, closedDates, closedMessage } = req.body as {
      ordersEnabled: boolean;
      closedDates: string[];
      closedMessage: string;
    };
    await upsertSetting("orders_enabled", String(ordersEnabled));
    await upsertSetting("closed_dates", JSON.stringify(closedDates ?? []));
    await upsertSetting("closed_message", closedMessage ?? "");
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

// ─── Events ──────────────────────────────────────────────────

router.get("/admin/events", async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    const rows = await db
      .select()
      .from(events)
      .orderBy(asc(events.eventDate), asc(events.sortOrder));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.post("/admin/events", async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    const { eventDate, hours, venue, subtitle, sortOrder } = req.body as {
      eventDate: string;
      hours: string;
      venue: string;
      subtitle: string;
      sortOrder?: number;
    };
    if (!eventDate || !hours || !venue || !subtitle) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const id = crypto.randomUUID();
    await db.insert(events).values({
      id,
      eventDate,
      hours,
      venue,
      subtitle,
      sortOrder: sortOrder ?? 0,
    });
    res.json({ ok: true, id });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
});

router.delete("/admin/events/:id", async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    await db.delete(events).where(eq(events.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

export default router;
