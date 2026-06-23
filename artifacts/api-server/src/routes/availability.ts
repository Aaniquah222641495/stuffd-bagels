import { Router } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { inArray } from "drizzle-orm";

const router = Router();

const KEYS = ["orders_enabled", "closed_dates", "closed_message"] as const;

export async function getAvailability() {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [...KEYS]));

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const ordersEnabled = map["orders_enabled"] !== "false";
  const closedDates: string[] = map["closed_dates"]
    ? JSON.parse(map["closed_dates"])
    : [];
  const closedMessage =
    map["closed_message"] ?? "We're closed today — check back soon!";

  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const closedToday = closedDates.includes(today);

  return { ordersEnabled, closedDates, closedMessage, closedToday };
}

router.get("/availability", async (req, res) => {
  try {
    const data = await getAvailability();
    res.json(data);
  } catch (err) {
    req.log.error(err);
    res.json({
      ordersEnabled: true,
      closedDates: [],
      closedMessage: "",
      closedToday: false,
    });
  }
});

export default router;
