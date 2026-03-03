import { Router, Request, Response } from "express";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent";

const DEFAULT_PROMPT =
  "Transform this 2D floor plan into a photorealistic bird's-eye view 3D rendering with modern luxury interior design. Furnish every room with high-end contemporary furniture, warm ambient lighting, marble floors, indoor plants, and tasteful decor. Professional architectural visualization quality. Output must be exactly 1024x1024 pixels.";

const router = Router();

// POST /api/floor-plan/generate — public endpoint for Try It section
router.post("/generate", upload.single("floorplan"), async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY is not set");
    res.status(500).json({ success: false, error: "Server misconfigured" });
    return;
  }

  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: "No file uploaded" });
      return;
    }

    console.log(`🎨 Floor plan generation — file: ${file.originalname}, size: ${file.size}, type: ${file.mimetype}`);

    const base64 = file.buffer.toString("base64");
    const mimeType = file.mimetype || "image/png";
    const prompt = (req.body.prompt as string) || DEFAULT_PROMPT;

    const body = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };

    console.log("🎨 Calling Gemini API...");
    const startTime = Date.now();
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const elapsed = Date.now() - startTime;
    console.log(`🎨 Gemini responded in ${elapsed}ms, status: ${geminiRes.status}`);

    if (!geminiRes.ok) {
      const text = await geminiRes.text();
      console.error(`❌ Gemini API error: ${geminiRes.status} ${text.slice(0, 500)}`);
      res.status(502).json({ success: false, error: "AI generation failed" });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await geminiRes.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imgPart = parts.find((p: any) => p.inlineData?.mimeType);

    if (!imgPart?.inlineData) {
      console.error("❌ No image in Gemini response");
      res.status(502).json({ success: false, error: "No image generated" });
      return;
    }

    console.log(`🎨 Floor plan generated successfully — ${imgPart.inlineData.mimeType}`);
    res.json({
      success: true,
      image: {
        data: imgPart.inlineData.data,
        mimeType: imgPart.inlineData.mimeType,
      },
    });
  } catch (err) {
    console.error("❌ Floor plan generation error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
