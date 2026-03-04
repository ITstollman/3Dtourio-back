import { Router, Request, Response } from "express";
import multer from "multer";
import { generateWorldFromImageBase64, generateWorldFromText } from "../lib/worldlabs";
import { updateSpace, getSpace, Revision } from "../lib/storage";
import { uploadImage } from "../lib/firebase";
import { randomUUID } from "crypto";
import { resolveAuthContext } from "../lib/auth";
import { db } from "../lib/firebase";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const router = Router();

// POST /api/generate — Trigger generation (accepts up to 15 images + optional floorplan)
router.post("/", upload.fields([{ name: "files", maxCount: 15 }, { name: "floorplan", maxCount: 1 }]), async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const spaceId = req.body.spaceId as string;
    const model = req.body.model as string | null;
    const uploadedFiles = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const files = uploadedFiles?.files || [];
    const floorplanFiles = uploadedFiles?.floorplan || [];

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

    const useGemini = model === "gemini";
    const draft = model === "Marble 0.1-mini";

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

      // Upload floor plan if provided
      if (floorplanFiles.length > 0) {
        const fp = floorplanFiles[0];
        const fpExt = fp.originalname.split(".").pop() || "png";
        const floorPlanUrl = await uploadImage(
          fp.buffer,
          `images/${spaceId}/floorplan.${fpExt}`,
          fp.mimetype || "image/png"
        );
        await updateSpace(spaceId, { floorPlanUrl } as any);
      }

      // Gemini mode: skip WorldLabs, use uploaded image directly
      if (useGemini) {
        const style = (req.body.style as string) || "modern_luxury";
        const prompt = (req.body.prompt as string) || "";
        const currentRevisions = space.revisions || [];

        if (currentRevisions.length >= 5) {
          console.log(`⚠️ POST /generate — space ${spaceId} max revisions reached`);
          res.status(400).json({ error: "Maximum revisions reached (5)", code: "MAX_REVISIONS" });
          return;
        }

        const revision: Revision = {
          id: randomUUID(),
          imageUrl: imageUrls[0],
          style,
          prompt,
          createdAt: new Date().toISOString(),
        };

        await updateSpace(spaceId, {
          status: "ready",
          thumbnailUrl: imageUrls[0],
          revisions: [...currentRevisions, revision],
        } as any);

        console.log(`🎨 Gemini mode — space ${spaceId} marked ready (revision ${currentRevisions.length + 1}/5)`);
        res.json({ status: "ready", revision });
        return;
      }

      // Use first image for 3D generation via WorldLabs
      const base64 = files[0].buffer.toString("base64");
      const operationId = await generateWorldFromImageBase64(base64, space.name, draft);

      await updateSpace(spaceId, {
        operationId,
        status: "generating",
      });

      console.log(`🎨 Generation started — space ${spaceId}, model: ${draft ? "mini" : "plus"}`);
      res.json({ operationId, status: "generating" });
    } else {
      console.log(`🎨 Text-only generation for space ${spaceId}`);
      const operationId = await generateWorldFromText(space.name, draft);

      await updateSpace(spaceId, {
        operationId,
        status: "generating",
      });

      console.log(`🎨 Generation started — space ${spaceId}, model: ${draft ? "mini" : "plus"}`);
      res.json({ operationId, status: "generating" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ Generate error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
