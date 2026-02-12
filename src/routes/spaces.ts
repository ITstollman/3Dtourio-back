import { Router, Request, Response } from "express";
import { getAllSpaces, createSpace, getSpace, updateSpace, deleteSpace, type Space } from "../lib/storage";
import { getAllTours, removeRoomFromTour } from "../lib/tours";
import { resolveAuthContext } from "../lib/auth";
import { createSpaceSchema, updateSpaceSchema } from "../lib/schemas";
import { randomUUID } from "crypto";

const router = Router();

// GET /api/spaces — List spaces for active team
router.get("/", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const spaces = await getAllSpaces(ctx.teamId);
  res.json(spaces);
});

// POST /api/spaces — Create new space
router.post("/", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createSpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, address, description, imageCount } = parsed.data;

  const space: Space = {
    id: randomUUID(),
    teamId: ctx.teamId,
    createdBy: ctx.uid,
    name,
    address,
    description,
    status: "uploading",
    imageCount,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await createSpace(space);
  res.status(201).json(space);
});

// GET /api/spaces/:id — Get single space
router.get("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const space = await getSpace(req.params.id as string);
  if (!space || space.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  res.json(space);
});

// PATCH /api/spaces/:id — Update space metadata
router.patch("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const existing = await getSpace(req.params.id as string);
  if (!existing || existing.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Space not found" });
    return;
  }

  const parsed = updateSpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const space = await updateSpace(req.params.id as string, parsed.data);
  res.json(space);
});

// DELETE /api/spaces/:id — Delete space + cascade remove from tours
router.delete("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const existing = await getSpace(req.params.id as string);
  if (!existing || existing.teamId !== ctx.teamId) {
    res.status(404).json({ error: "Space not found" });
    return;
  }

  await deleteSpace(req.params.id as string);

  const tours = await getAllTours(ctx.teamId);
  for (const tour of tours) {
    if (tour.rooms.some((r) => r.spaceId === req.params.id as string)) {
      await removeRoomFromTour(tour.id, req.params.id as string);
    }
  }

  res.json({ success: true });
});

export default router;
