import { db } from "./firebase";
import { randomBytes } from "crypto";

const COLLECTION = "teams";

export interface Team {
  id: string;
  name: string;
  type: "personal" | "organization";
  ownerId: string;
  memberIds: string[];
  inviteCode: string;
  inviteEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function getTeam(id: string): Promise<Team | undefined> {
  const doc = await db.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as Team) : undefined;
}

export async function getTeamsByUser(userId: string): Promise<Team[]> {
  const snapshot = await db
    .collection(COLLECTION)
    .where("memberIds", "array-contains", userId)
    .get();
  return snapshot.docs.map((doc) => doc.data() as Team);
}

export async function createTeam(team: Team): Promise<Team> {
  await db.collection(COLLECTION).doc(team.id).set(team);
  return team;
}

export async function updateTeam(
  id: string,
  updates: Partial<Team>
): Promise<Team | null> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const merged = {
    ...doc.data(),
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await ref.set(merged, { merge: true });
  return merged as Team;
}

export async function deleteTeam(id: string): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

export async function getTeamByInviteCode(
  code: string
): Promise<Team | undefined> {
  const snapshot = await db
    .collection(COLLECTION)
    .where("inviteCode", "==", code)
    .where("inviteEnabled", "==", true)
    .limit(1)
    .get();
  return snapshot.empty ? undefined : (snapshot.docs[0].data() as Team);
}

export function generateInviteCode(): string {
  return randomBytes(8).toString("base64url").slice(0, 12);
}

export async function addMemberToTeam(
  teamId: string,
  userId: string
): Promise<Team | null> {
  return db.runTransaction(async (txn) => {
    const ref = db.collection(COLLECTION).doc(teamId);
    const doc = await txn.get(ref);
    if (!doc.exists) return null;
    const team = doc.data() as Team;
    if (team.memberIds.includes(userId)) return team;
    const memberIds = [...team.memberIds, userId];
    const updates = { memberIds, updatedAt: new Date().toISOString() };
    txn.update(ref, updates);
    return { ...team, ...updates };
  });
}

export async function removeMemberFromTeam(
  teamId: string,
  userId: string
): Promise<Team | null> {
  return db.runTransaction(async (txn) => {
    const ref = db.collection(COLLECTION).doc(teamId);
    const doc = await txn.get(ref);
    if (!doc.exists) return null;
    const team = doc.data() as Team;
    if (team.ownerId === userId) return null;
    if (team.type === "personal") return null;
    const memberIds = team.memberIds.filter((id) => id !== userId);
    const updates = { memberIds, updatedAt: new Date().toISOString() };
    txn.update(ref, updates);
    return { ...team, ...updates };
  });
}
