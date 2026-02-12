import { Router, Request, Response } from "express";
import { getTourByToken } from "../lib/tours";
import { getSpacesByIds } from "../lib/storage";

const router = Router();

// GET /api/t/:token — Public tour viewing (no auth)
router.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as Record<string, string>;
  const tour = await getTourByToken(token);

  if (!tour || !tour.isPublic) {
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

  res.json(populated);
});

export default router;
