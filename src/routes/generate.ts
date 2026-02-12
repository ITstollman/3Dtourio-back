import { Router, Request, Response } from "express";
import multer from "multer";
import { generateWorldFromImageBase64, generateWorldFromText } from "../lib/worldlabs";
import { updateSpace, getSpace } from "../lib/storage";
import { uploadImage } from "../lib/firebase";
import { resolveAuthContext } from "../lib/auth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const router = Router();

// POST /api/generate — Trigger 3D generation
router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const spaceId = req.body.spaceId as string;
    const model = req.body.model as string | null;
    const file = req.file;

    if (!spaceId) {
      res.status(400).json({ error: "spaceId is required" });
      return;
    }

    const space = await getSpace(spaceId);
    if (!space || space.teamId !== ctx.teamId) {
      res.status(404).json({ error: "Space not found" });
      return;
    }

    const draft = model === "Marble 0.1-mini";
    let operationId: string;

    if (file) {
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        res.status(400).json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, HEIC" });
        return;
      }

      console.log(`🎨 Image uploaded for space ${spaceId} (${file.size} bytes)`);
      const base64 = file.buffer.toString("base64");

      const ext = file.originalname.split(".").pop() || "jpg";
      const imageUrl = await uploadImage(
        file.buffer,
        `images/${spaceId}/original.${ext}`,
        file.mimetype || "image/jpeg"
      );
      await updateSpace(spaceId, { originalImageUrl: imageUrl });

      operationId = await generateWorldFromImageBase64(base64, space.name, draft);
    } else {
      operationId = await generateWorldFromText(space.name, draft);
    }

    await updateSpace(spaceId, {
      operationId,
      status: "generating",
    });

    console.log(`🎨 Generation started — space ${spaceId}, model: ${draft ? "mini" : "plus"}`);
    res.json({ operationId, status: "generating" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ Generate error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
