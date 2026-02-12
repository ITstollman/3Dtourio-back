import { Router, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import "../lib/firebase";
import { db } from "../lib/firebase";
import { verifyAuthToken } from "../lib/auth";
import { generateInviteCode } from "../lib/teams";
import { sessionSchema, onboardingSchema, updateProfileSchema } from "../lib/schemas";
import { randomUUID } from "crypto";

const router = Router();

// POST /api/auth/session — Create session cookie
router.post("/session", async (req: Request, res: Response) => {
  try {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log("⚠️ POST /auth/session — invalid request body");
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const { token } = parsed.data;
    const decoded = await getAuth().verifyIdToken(token);

    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await getAuth().createSessionCookie(token, { expiresIn });

    res.cookie("session", sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    console.log(`🔐 Session created for user ${decoded.uid}`);
    res.json({ status: "success" });
  } catch {
    console.log("⚠️ POST /auth/session — invalid or expired token");
    res.status(401).json({ error: "Invalid token" });
  }
});

// DELETE /api/auth/session — Clear session cookie
router.delete("/session", (_req: Request, res: Response) => {
  res.clearCookie("session", { path: "/" });
  console.log("🔐 Session cleared");
  res.json({ status: "success" });
});

// GET /api/auth/me — Get current user profile
router.get("/me", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.log(`🔐 GET /auth/me — user ${decoded.uid}`);
  const doc = await db.collection("users").doc(decoded.uid).get();
  if (!doc.exists) {
    console.log(`👤 User ${decoded.uid} has no profile yet (needs onboarding)`);
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
    console.log(`⚠️ POST /auth/onboarding — validation failed for user ${decoded.uid}`);
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

  console.log(`👤 Onboarding complete — user ${decoded.uid}, type: ${parsed.data.businessType}`);
  res.json({ success: true, teamId });
});

// PATCH /api/auth/me — Update user profile
router.patch("/me", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ PATCH /auth/me — validation failed for user ${decoded.uid}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const updates: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };

  try {
    // Update Firestore user doc
    await db.collection("users").doc(decoded.uid).set(updates, { merge: true });

    // Sync displayName to Firebase Auth
    if (updates.displayName) {
      await getAuth().updateUser(decoded.uid, {
        displayName: updates.displayName as string,
      });
    }

    const doc = await db.collection("users").doc(decoded.uid).get();
    console.log(`👤 Profile updated — user ${decoded.uid}`);
    res.json(doc.data());
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// DELETE /api/auth/me — Delete user account
router.delete("/me", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Check if user owns any teams
    const ownedTeams = await db
      .collection("teams")
      .where("ownerId", "==", decoded.uid)
      .where("type", "==", "organization")
      .get();

    if (!ownedTeams.empty) {
      console.log(`⚠️ DELETE /auth/me — user ${decoded.uid} still owns ${ownedTeams.size} org teams`);
      res.status(400).json({
        error: "Transfer or delete your teams before deleting your account",
      });
      return;
    }

    // Remove user from all team memberIds
    const memberTeams = await db
      .collection("teams")
      .where("memberIds", "array-contains", decoded.uid)
      .get();

    const batch = db.batch();

    console.log(`👤 Deleting account for user ${decoded.uid} — cleaning up ${memberTeams.size} team memberships`);
    for (const teamDoc of memberTeams.docs) {
      const team = teamDoc.data();
      if (team.type === "personal") {
        // Delete personal team
        batch.delete(teamDoc.ref);
      } else {
        // Remove from org team memberIds
        batch.update(teamDoc.ref, {
          memberIds: team.memberIds.filter((id: string) => id !== decoded.uid),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Delete user doc
    batch.delete(db.collection("users").doc(decoded.uid));

    await batch.commit();

    // Delete Firebase Auth user
    await getAuth().deleteUser(decoded.uid);

    console.log(`👤 Account deleted — user ${decoded.uid}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Account deletion error:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export default router;
