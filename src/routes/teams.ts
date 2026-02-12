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

  const teams = await getTeamsByUser(decoded.uid);
  const userDoc = await db.collection("users").doc(decoded.uid).get();
  const activeTeamId = userDoc.data()?.activeTeamId || null;

  res.json({ teams, activeTeamId });
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

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

  res.status(201).json(team);
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const team = await getTeam(parsed.data.teamId);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  await db.collection("users").doc(decoded.uid).update({
    activeTeamId: parsed.data.teamId,
  });

  res.json({ success: true });
});

// GET /api/teams/join?code=... — Preview team by invite code (no auth)
router.get("/join", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const team = await getTeamByInviteCode(code);
  if (!team) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json({
    teamName: team.name,
    memberCount: team.memberIds.length,
  });
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const team = await getTeamByInviteCode(parsed.data.inviteCode);
  if (!team) {
    res.status(404).json({ error: "Invalid or expired invite code" });
    return;
  }

  if (team.memberIds.includes(decoded.uid)) {
    res.status(409).json({ error: "Already a member", teamId: team.id });
    return;
  }

  await addMemberToTeam(team.id, decoded.uid);

  await db.collection("users").doc(decoded.uid).update({
    teamIds: FieldValue.arrayUnion(team.id),
  });

  res.json({ success: true, teamId: team.id, teamName: team.name });
});

// GET /api/teams/:id — Get team details
router.get("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const team = await getTeam(req.params.id as string);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  res.json(team);
});

// PATCH /api/teams/:id — Update team name
router.patch("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const team = await getTeam(req.params.id as string);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const updated = await updateTeam(req.params.id as string, { name: parsed.data.name });
  res.json(updated);
});

// DELETE /api/teams/:id — Delete team
router.delete("/:id", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const team = await getTeam(req.params.id as string);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  if (team.type === "personal") {
    res.status(400).json({ error: "Cannot delete personal team" });
    return;
  }

  if (team.ownerId !== decoded.uid) {
    res.status(403).json({ error: "Only the team owner can delete the team" });
    return;
  }

  const spaces = await getAllSpaces(req.params.id as string);
  const tours = await getAllTours(req.params.id as string);
  if (spaces.length > 0 || tours.length > 0) {
    res.status(400).json({ error: "Cannot delete team with existing spaces or tours" });
    return;
  }

  await deleteTeam(req.params.id as string);
  res.json({ success: true });
});

// POST /api/teams/:id/invite — Regenerate invite code
router.post("/:id/invite", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const team = await getTeam(req.params.id as string);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const updated = await updateTeam(req.params.id as string, { inviteCode: generateInviteCode() });
  res.json(updated);
});

// PATCH /api/teams/:id/invite — Enable/disable invites
router.patch("/:id/invite", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const team = await getTeam(req.params.id as string);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const parsed = updateInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const updated = await updateTeam(req.params.id as string, {
    inviteEnabled: parsed.data.enabled,
  });
  res.json(updated);
});

// DELETE /api/teams/:id/members — Leave team
router.delete("/:id/members", async (req: Request, res: Response) => {
  const decoded = await verifyAuthToken(req);
  if (!decoded) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = req.params.id as string;
  const team = await getTeam(id);
  if (!team || !team.memberIds.includes(decoded.uid)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  if (team.type === "personal") {
    res.status(400).json({ error: "Cannot leave personal team" });
    return;
  }

  if (team.ownerId === decoded.uid) {
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

  res.json({ success: true });
});

export default router;
