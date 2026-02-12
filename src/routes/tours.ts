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

  res.json(populated);
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, address, description } = parsed.data;

  const tour: Tour = {
    id: randomUUID(),
    teamId: ctx.teamId,
    createdBy: ctx.uid,
    name,
    address,
    description,
    rooms: [],
    isPublic: false,
    shareToken: randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await createTour(tour);
  res.status(201).json(tour);
});

// GET /api/tours/:id — Get tour with populated rooms
router.get("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tour = await getTour(req.params.id as string);
  if (!tour || tour.teamId !== ctx.teamId) {
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

  res.json(populated);
});

// PATCH /api/tours/:id — Update tour metadata
router.patch("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const existing = await getTour(req.params.id as string);
  if (!existing || existing.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Tour not found" });
    return;
  }

  const parsed = updateTourSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const tour = await updateTour(req.params.id as string, parsed.data);
  res.json(tour);
});

// DELETE /api/tours/:id — Delete tour
router.delete("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const existing = await getTour(req.params.id as string);
  if (!existing || existing.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Tour not found" });
    return;
  }

  await deleteTour(req.params.id as string);
  res.json({ success: true });
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { spaceId, label } = parsed.data;

  const tour = await getTour(req.params.id as string);
  if (!tour || tour.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Tour not found" });
    return;
  }

  const order = tour.rooms.length;
  const updated = await addRoomToTour(req.params.id as string, { spaceId, label, order });
  res.json(updated);
});

// DELETE /api/tours/:id/rooms?spaceId=... — Remove room from tour
router.delete("/:id/rooms", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tour = await getTour(req.params.id as string);
  if (!tour || tour.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Tour not found" });
    return;
  }

  const spaceId = req.query.spaceId as string;
  if (!spaceId) {
    res.status(400).json({ error: "spaceId is required" });
    return;
  }

  const updated = await removeRoomFromTour(req.params.id as string, spaceId);
  res.json(updated);
});

export default router;
