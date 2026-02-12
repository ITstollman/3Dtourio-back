import { Router, Request, Response } from "express";
import { getAllSpaces, createSpace, getSpace, updateSpace, deleteSpace, deleteSpaceFiles, type Space } from "../lib/storage";
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

  try {
    const spaces = await getAllSpaces(ctx.teamId);
    console.log(`🏠 Listed ${spaces.length} spaces for team ${ctx.teamId}`);
    res.json(spaces);
  } catch (err) {
    console.error("❌ Failed to list spaces:", err);
    res.status(500).json({ error: "Internal server error" });
  }
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
    console.log(`⚠️ POST /spaces — validation failed for team ${ctx.teamId}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
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
    console.log(`🏠 Space created: "${name}" in team ${ctx.teamId}`);
    res.status(201).json(space);
  } catch (err) {
    console.error("❌ Failed to create space:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/spaces/:id — Get single space
router.get("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const space = await getSpace(req.params.id as string);
    if (!space || space.teamId !== ctx.teamId) {
      console.log(`⚠️ GET /spaces/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Space not found" });
      return;
    }
    console.log(`🏠 Space ${req.params.id} fetched`);
    res.json(space);
  } catch (err) {
    console.error("❌ Failed to get space:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/spaces/:id — Update space metadata
router.patch("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const existing = await getSpace(req.params.id as string);
    if (!existing || existing.teamId !== ctx.teamId) {
      console.log(`⚠️ PATCH /spaces/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Space not found" });
      return;
    }

    const parsed = updateSpaceSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log(`⚠️ PATCH /spaces/${req.params.id} — validation failed`);
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const space = await updateSpace(req.params.id as string, parsed.data);
    console.log(`🏠 Space ${req.params.id} updated`);
    res.json(space);
  } catch (err) {
    console.error("❌ Failed to update space:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/spaces/:id — Delete space + cascade remove from tours + cleanup storage
router.delete("/:id", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const existing = await getSpace(req.params.id as string);
    if (!existing || existing.teamId !== ctx.teamId) {
      console.log(`⚠️ DELETE /spaces/${req.params.id} — not found or wrong team`);
      res.status(404).json({ error: "Space not found" });
      return;
    }

    await deleteSpace(req.params.id as string);

    // Clean up storage files (non-blocking)
    deleteSpaceFiles(req.params.id as string).catch((err) =>
      console.error("⚠️ Failed to clean up storage files:", err)
    );

    // Cascade remove from tours
    const tours = await getAllTours(ctx.teamId);
    for (const tour of tours) {
      if (tour.rooms.some((r) => r.spaceId === (req.params.id as string))) {
        await removeRoomFromTour(tour.id, req.params.id as string);
      }
    }

    console.log(`🏠 Space ${req.params.id} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to delete space:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
