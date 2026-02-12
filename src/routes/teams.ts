import { Router, Request, Response } from "express";
import {
  getTeam,
  getTeamsByUser,
  createTeam,
  updateTeam,
  deleteTeam,
  generateInviteCode,
  getTeamByInviteCode,
  addMemberToTeam,
  removeMemberFromTeam,
  type Team,
} from "../lib/teams";
import { getAllSpaces } from "../lib/storage";
import { getAllTours } from "../lib/tours";
import { verifyAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import {
  createTeamSchema,
  joinTeamSchema,
  switchTeamSchema,
  updateInviteSchema,
} from "../lib/schemas";
import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";

const router = Router();

// GET /api/teams — List user's teams
router.get("/", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const teams = await getTeamsByUser(decoded.uid);
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const activeTeamId = userDoc.data()?.activeTeamId || null;

    console.log(`👥 Listed ${teams.length} teams for user ${decoded.uid}`);
    res.json({ teams, activeTeamId });
  } catch (err) {
    console.error("❌ Failed to list teams:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/teams — Create new team
router.post("/", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ POST /teams — validation failed for user ${decoded.uid}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const now = new Date().toISOString();
    const teamId = randomUUID();

    const team: Team = {
      id: teamId,
      name: parsed.data.name,
      type: "organization",
      ownerId: decoded.uid,
      memberIds: [decoded.uid],
      inviteCode: generateInviteCode(),
      inviteEnabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection("teams").doc(teamId), team);
    batch.update(db.collection("users").doc(decoded.uid), {
      teamIds: FieldValue.arrayUnion(teamId),
    });
    await batch.commit();

    console.log(`👥 Team created: "${parsed.data.name}" by ${decoded.uid}`);
    res.status(201).json(team);
  } catch (err) {
    console.error("❌ Failed to create team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/teams/active — Switch active team
router.put("/active", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = switchTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ PUT /teams/active — validation failed for user ${decoded.uid}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const team = await getTeam(parsed.data.teamId);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ PUT /teams/active — team ${parsed.data.teamId} not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    await db.collection("users").doc(decoded.uid).update({
      activeTeamId: parsed.data.teamId,
    });

    console.log(`👥 Active team switched to ${parsed.data.teamId} for user ${decoded.uid}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to switch team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/teams/join?code=... — Preview team by invite code (no auth)
router.get("/join", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    console.log("⚠️ GET /teams/join — missing invite code query param");
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    const team = await getTeamByInviteCode(code);
    if (!team) {
      console.log(`⚠️ GET /teams/join — invite code "${code}" not found or disabled`);
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    console.log(`👥 Team preview requested: code ${code}`);
    res.json({
      teamName: team.name,
      memberCount: team.memberIds.length,
    });
  } catch (err) {
    console.error("❌ Failed to preview team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/teams/join — Join team by invite code
router.post("/join", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = joinTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`⚠️ POST /teams/join — validation failed for user ${decoded.uid}`);
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const team = await getTeamByInviteCode(parsed.data.inviteCode);
    if (!team) {
      console.log(`⚠️ POST /teams/join — invite code "${parsed.data.inviteCode}" not found`);
      res.status(404).json({ error: "Invalid or expired invite code" });
      return;
    }

    if (team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ POST /teams/join — user ${decoded.uid} already a member of team ${team.id}`);
      res.status(409).json({ error: "Already a member", teamId: team.id });
      return;
    }

    await addMemberToTeam(team.id, decoded.uid);

    await db.collection("users").doc(decoded.uid).update({
      teamIds: FieldValue.arrayUnion(team.id),
    });

    console.log(`👥 User ${decoded.uid} joined team ${team.id}`);
    res.json({ success: true, teamId: team.id, teamName: team.name });
  } catch (err) {
    console.error("❌ Failed to join team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/teams/:id — Get team details
router.get("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const team = await getTeam(req.params.id as string);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ GET /teams/${req.params.id} — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    console.log(`👥 Team ${req.params.id} details fetched`);
    res.json(team);
  } catch (err) {
    console.error("❌ Failed to get team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/teams/:id — Update team name
router.patch("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const team = await getTeam(req.params.id as string);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ PATCH /teams/${req.params.id} — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log(`⚠️ PATCH /teams/${req.params.id} — validation failed`);
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const updated = await updateTeam(req.params.id as string, { name: parsed.data.name });
    console.log(`👥 Team ${req.params.id} updated: name="${parsed.data.name}"`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/teams/:id — Delete team
router.delete("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const team = await getTeam(req.params.id as string);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ DELETE /teams/${req.params.id} — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    if (team.type === "personal") {
      console.log(`⚠️ DELETE /teams/${req.params.id} — attempted to delete personal team`);
      res.status(400).json({ error: "Cannot delete personal team" });
      return;
    }

    if (team.ownerId !== decoded.uid) {
      console.log(`⚠️ DELETE /teams/${req.params.id} — user ${decoded.uid} is not the owner`);
      res.status(403).json({ error: "Only the team owner can delete the team" });
      return;
    }

    const spaces = await getAllSpaces(req.params.id as string);
    const tours = await getAllTours(req.params.id as string);
    if (spaces.length > 0 || tours.length > 0) {
      console.log(`⚠️ DELETE /teams/${req.params.id} — has ${spaces.length} spaces and ${tours.length} tours`);
      res.status(400).json({ error: "Cannot delete team with existing spaces or tours" });
      return;
    }

    await deleteTeam(req.params.id as string);
    console.log(`👥 Team ${req.params.id} deleted by ${decoded.uid}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to delete team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/teams/:id/invite — Regenerate invite code
router.post("/:id/invite", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const team = await getTeam(req.params.id as string);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ POST /teams/${req.params.id}/invite — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const updated = await updateTeam(req.params.id as string, { inviteCode: generateInviteCode() });
    console.log(`👥 Invite code regenerated for team ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to regenerate invite:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/teams/:id/invite — Enable/disable invites
router.patch("/:id/invite", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const team = await getTeam(req.params.id as string);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ PATCH /teams/${req.params.id}/invite — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const parsed = updateInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log(`⚠️ PATCH /teams/${req.params.id}/invite — validation failed`);
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const updated = await updateTeam(req.params.id as string, {
      inviteEnabled: parsed.data.enabled,
    });
    console.log(`👥 Invite ${parsed.data.enabled ? "enabled" : "disabled"} for team ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update invite:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/teams/:id/members — Leave team
router.delete("/:id/members", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const id = req.params.id as string;
    const team = await getTeam(id);
    if (!team || !team.memberIds.includes(decoded.uid)) {
      console.log(`⚠️ DELETE /teams/${id}/members — not found or not a member`);
      res.status(404).json({ error: "Team not found" });
      return;
    }

    if (team.type === "personal") {
      console.log(`⚠️ DELETE /teams/${id}/members — attempted to leave personal team`);
      res.status(400).json({ error: "Cannot leave personal team" });
      return;
    }

    if (team.ownerId === decoded.uid) {
      console.log(`⚠️ DELETE /teams/${id}/members — owner ${decoded.uid} attempted to leave`);
      res.status(400).json({ error: "Owner cannot leave the team" });
      return;
    }

    await removeMemberFromTeam(id, decoded.uid);

    const userRef = db.collection("users").doc(decoded.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    const personalTeamId =
      userData?.teamIds?.find((tid: string) => tid !== id) || null;

    await userRef.update({
      teamIds: FieldValue.arrayRemove(id),
      activeTeamId: personalTeamId,
    });

    console.log(`👥 User ${decoded.uid} left team ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to leave team:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
