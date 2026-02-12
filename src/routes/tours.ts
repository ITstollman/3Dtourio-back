import { Router, Request, Response } from "express";
import {
  getAllTours,
  createTour,
  getTour,
  updateTour,
  deleteTour,
  addRoomToTour,
  removeRoomFromTour,
  type Tour,
} from "../lib/tours";
import { getSpacesByIds } from "../lib/storage";
import { resolveAuthContext } from "../lib/auth";
import { createTourSchema, updateTourSchema, addRoomSchema } from "../lib/schemas";
import { randomUUID, randomBytes } from "crypto";

const router = Router();

// GET /api/tours — List tours with populated rooms
router.get("/", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const tours = await getAllTours(ctx.teamId);

    const spaceIds = [...new Set(tours.flatMap((t) => t.rooms.map((r) => r.spaceId)))];
    const spaces = await getSpacesByIds(spaceIds);

    const populated = tours.map((tour) => ({
      ...tour,
      rooms: tour.rooms.map((room) => ({
        ...room,
        space: spaces.find((s) => s.id === room.spaceId) || null,
      })),
    }));

    console.log(`🗺️ Listed ${tours.length} tours for team ${ctx.teamId}`);
    res.json(populated);
  } catch (err) {
    console.error("❌ Failed to list tours:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tours — Create new tour
router.post("/", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createTourSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ POST /tours — validation failed for team ${ctx.teamId}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const { name, address, description } = parsed.data;

    const tour: Tour = {
      id: randomUUID(),
      teamId: ctx.teamId,
      createdBy: ctx.uid,
      name,
      address,
      description,
      rooms: [],
      isPublic: true,
      shareToken: randomBytes(16).toString("hex"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createTour(tour);
    console.log(`🗺️ Tour created: "${name}" in team ${ctx.teamId}`);
    res.status(201).json(tour);
  } catch (err) {
    console.error("❌ Failed to create tour:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tours/:id — Get tour with populated rooms
router.get("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const tour = await getTour(req.params.id as string);
    if (!tour || tour.teamId !== ctx.teamId) {
      console.log(`⚠️ GET /tours/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Tour not found" });
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

    console.log(`🗺️ Tour ${req.params.id} fetched with ${tour.rooms.length} rooms`);
    res.json(populated);
  } catch (err) {
    console.error("❌ Failed to get tour:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/tours/:id — Update tour metadata
router.patch("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const existing = await getTour(req.params.id as string);
    if (!existing || existing.teamId !== ctx.teamId) {
      console.log(`⚠️ PATCH /tours/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Tour not found" });
      return;
    }

    const parsed = updateTourSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log(`⚠️ PATCH /tours/${req.params.id} — validation failed`);
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const tour = await updateTour(req.params.id as string, parsed.data);
    console.log(`🗺️ Tour ${req.params.id} updated`);
    res.json(tour);
  } catch (err) {
    console.error("❌ Failed to update tour:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/tours/:id — Delete tour
router.delete("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const existing = await getTour(req.params.id as string);
    if (!existing || existing.teamId !== ctx.teamId) {
      console.log(`⚠️ DELETE /tours/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Tour not found" });
      return;
    }

    await deleteTour(req.params.id as string);
    console.log(`🗺️ Tour ${req.params.id} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to delete tour:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tours/:id/rooms — Add room to tour
router.post("/:id/rooms", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = addRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ POST /tours/${req.params.id}/rooms — validation failed`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const { spaceId, label } = parsed.data;

    const tour = await getTour(req.params.id as string);
    if (!tour || tour.teamId !== ctx.teamId) {
      console.log(`⚠️ POST /tours/${req.params.id}/rooms — tour not found`);
      res.status(404).json({ error: "Tour not found" });
      return;
    }

    const order = tour.rooms.length;
    const updated = await addRoomToTour(req.params.id as string, { spaceId, label, order });
    console.log(`🗺️ Room added to tour ${req.params.id}: "${label}" (space ${spaceId})`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to add room:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/tours/:id/rooms?spaceId=... — Remove room from tour
router.delete("/:id/rooms", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const tour = await getTour(req.params.id as string);
    if (!tour || tour.teamId !== ctx.teamId) {
      console.log(`⚠️ DELETE /tours/${req.params.id}/rooms — tour not found`);
      res.status(404).json({ error: "Tour not found" });
      return;
    }

    const spaceId = req.query.spaceId as string;
    if (!spaceId) {
      console.log(`⚠️ DELETE /tours/${req.params.id}/rooms — missing spaceId query param`);
      res.status(400).json({ error: "spaceId is required" });
      return;
    }

    const updated = await removeRoomFromTour(req.params.id as string, spaceId);
    console.log(`🗺️ Room removed from tour ${req.params.id}: space ${spaceId}`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to remove room:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
