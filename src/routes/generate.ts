import { Router, Request, Response } from "express";
import multer from "multer";
import { generateWorldFromImageBase64, generateWorldFromText } from "../lib/worldlabs";
import { updateSpace, getSpace } from "../lib/storage";
import { uploadImage } from "../lib/firebase";
import { resolveAuthContext } from "../lib/auth";
import { db } from "../lib/firebase";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const router = Router();

// POST /api/generate — Trigger 3D generation (accepts up to 15 images)
router.post("/", upload.array("files", 15), async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const spaceId = req.body.spaceId as string;
    const model = req.body.model as string | null;
    const files = (req.files as Express.Multer.File[]) || [];

    if (!spaceId) {
      console.log("⚠️ POST /generate — missing spaceId");
      res.status(400).json({ error: "spaceId is required" });
      return;
    }

    const space = await getSpace(spaceId);
    if (!space || space.teamId !== ctx.teamId) {
      console.log(`⚠️ POST /generate — space ${spaceId} not found or wrong team`);
      res.status(404).json({ error: "Space not found" });
      return;
    }

    // Credit check — deduct 1 credit atomically
    // Skip for legacy teams that don't have credits field (pre-billing)
    const teamRef = db.collection("teams").doc(ctx.teamId);
    const hasCredit = await db.runTransaction(async (tx) => {
      const teamDoc = await tx.get(teamRef);
      const team = teamDoc.data();
      if (team?.credits === undefined) return true; // legacy team — no limits
      const credits = team.credits as number;
      const creditsUsed = (team.creditsUsed as number) ?? 0;
      if (creditsUsed >= credits) return false;
      tx.update(teamRef, { creditsUsed: creditsUsed + 1 });
      return true;
    });

    if (!hasCredit) {
      console.log(`⚠️ POST /generate — team ${ctx.teamId} has no credits remaining`);
      res.status(402).json({ error: "No credits remaining", code: "NO_CREDITS" });
      return;
    }

    const draft = model === "Marble 0.1-mini";
    let operationId: string;

    if (files.length > 0) {
      // Validate all file types
      for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
          console.log(`⚠️ POST /generate — rejected file type: ${file.mimetype}`);
          res.status(400).json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, HEIC" });
          return;
        }
      }

      console.log(`🎨 ${files.length} image(s) uploaded for space ${spaceId}`);

      // Upload all images to storage in parallel
      const imageUrls = await Promise.all(
        files.map(async (file, i) => {
          const ext = file.originalname.split(".").pop() || "jpg";
          return uploadImage(
            file.buffer,
            `images/${spaceId}/${i}.${ext}`,
            file.mimetype || "image/jpeg"
          );
        })
      );

      // Store all image URLs and use first as originalImageUrl
      await updateSpace(spaceId, {
        originalImageUrl: imageUrls[0],
        imageUrls,
        imageCount: imageUrls.length,
      });

      // Use first image for 3D generation
      const base64 = files[0].buffer.toString("base64");
      operationId = await generateWorldFromImageBase64(base64, space.name, draft);
    } else {
      console.log(`🎨 Text-only generation for space ${spaceId}`);
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
