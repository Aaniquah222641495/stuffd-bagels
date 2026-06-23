import { Router } from "express";
import { db } from "@workspace/db";
import { events } from "@workspace/db";
import { asc } from "drizzle-orm";

const router = Router();

router.get("/events", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(events)
      .orderBy(asc(events.eventDate), asc(events.sortOrder));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.json([]);
  }
});

export default router;
