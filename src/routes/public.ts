import { Router, Request, Response } from "express";
import { getTourByToken } from "../lib/tours";
import { getSpacesByIds } from "../lib/storage";

const router = Router();

// GET /api/t/:token — Public tour viewing (no auth)
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params as Record<string, string>;
    const tour = await getTourByToken(token);

    if (!tour || !tour.isPublic) {
      console.log(`⚠️ Public tour not found — token ${token}`);
      res.status(404).json({ error: "Not found" });
      return;
    }

    const spaceIds = tour.rooms.map((r) => r.spaceId);
    const spaces = await getSpacesByIds(spaceIds);
    const populated = {
      ...tour,
      rooms: tour.rooms.map((room) => ({
        ...room,
        space: spaces.find((s) => s.id === room.spaceId) || null,
      })),
    };

    console.log(`🌐 Public tour accessed — token ${token}`);
    res.json(populated);
  } catch (err) {
    console.error("❌ Failed to fetch public tour:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
