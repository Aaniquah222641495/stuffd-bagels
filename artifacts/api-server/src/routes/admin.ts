import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAvailability } from "./availability";

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

export default router;
