import { Router, Request, Response } from "express";
import { getOperation, getWorld } from "../lib/worldlabs";
import { getAllSpaces, updateSpace } from "../lib/storage";
import { resolveAuthContext } from "../lib/auth";
import { compressAndUploadAssets } from "../lib/compress";

const router = Router();

// GET /api/status/:operationId — Poll generation status
router.get("/:operationId", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { operationId } = req.params as Record<string, string>;
  console.log(`📊 Status check — operation ${operationId}`);

  const spaces = await getAllSpaces(ctx.teamId);
  const space = spaces.find((s) => s.operationId === operationId);
  if (!space) {
    res.status(404).json({ error: "Operation not found" });
    return;
  }

  try {
    const operation = await getOperation(operationId);

    if (operation.done && operation.response) {
      const worldId = operation.response.world_id;
      const world = await getWorld(worldId);

      console.log(`📊 Generation complete — space ${space.id}, world ${worldId}`);
      const compressed = await compressAndUploadAssets(space.id, {
        thumbnail_url: world.assets?.thumbnail_url,
        panorama_url: world.assets?.panorama_url,
        splats: world.assets?.splats,
        mesh: world.assets?.mesh,
      });

      await updateSpace(space.id, {
        status: "ready",
        worldId: world.world_id,
        thumbnailUrl: compressed.thumbnailUrl,
        panoramaUrl: compressed.panoramaUrl,
        splatUrl: compressed.splatUrl,
        splatUrl500k: compressed.splatUrl500k,
        splatUrl100k: compressed.splatUrl100k,
        meshUrl: compressed.meshUrl,
        marbleUrl: world.world_marble_url,
      });

      res.json({ done: true, world });
      return;
    }

    if (operation.done && operation.error) {
      console.log(`⚠️ Generation failed — space ${space.id}: ${operation.error.message}`);
      await updateSpace(space.id, {
        status: "failed",
        errorMessage: operation.error.message,
      });

      res.json({ done: true, error: operation.error.message });
      return;
    }

    res.json({ done: false, operationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ Status check error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
