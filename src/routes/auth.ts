import { Router, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import "../lib/firebase";
import { db } from "../lib/firebase";
import { verifyAuthToken } from "../lib/auth";
import { generateInviteCode } from "../lib/teams";
import { sessionSchema, onboardingSchema } from "../lib/schemas";
import { randomUUID } from "crypto";

const router = Router();

// POST /api/auth/session — Create session cookie
router.post("/session", async (req: Request, res: Response) => {
  try {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const { token } = parsed.data;
    await getAuth().verifyIdToken(token);

    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await getAuth().createSessionCookie(token, { expiresIn });

    res.cookie("session", sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    res.json({ status: "success" });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// DELETE /api/auth/session — Clear session cookie
router.delete("/session", (_req: Request, res: Response) => {
  res.clearCookie("session", { path: "/" });
  res.json({ status: "success" });
});

// GET /api/auth/me — Get current user profile
router.get("/me", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const doc = await db.collection("users").doc(decoded.uid).get();
  if (!doc.exists) {
    res.json({
      uid: decoded.uid,
      email: decoded.email,
      onboardingComplete: false,
    });
    return;
  }

  const data = doc.data();
  res.json({
    ...data,
    activeTeamId: data?.activeTeamId || null,
    teamIds: data?.teamIds || [],
  });
});

// POST /api/auth/onboarding — Complete onboarding
router.post("/onboarding", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const teamId = randomUUID();
  const now = new Date().toISOString();
  const displayName = decoded.name || decoded.email || "My";

  const batch = db.batch();

  batch.set(db.collection("teams").doc(teamId), {
    id: teamId,
    name: `${displayName}'s Team`,
    type: "personal",
    ownerId: decoded.uid,
    memberIds: [decoded.uid],
    inviteCode: generateInviteCode(),
    inviteEnabled: false,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(
    db.collection("users").doc(decoded.uid),
    {
      uid: decoded.uid,
      email: decoded.email || "",
      displayName: decoded.name || "",
      businessType: parsed.data.businessType,
      onboardingComplete: true,
      activeTeamId: teamId,
      teamIds: [teamId],
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  res.json({ success: true, teamId });
});

export default router;
