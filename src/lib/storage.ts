import { db } from "./firebase";

const COLLECTION = "spaces";

export interface Space {
  id: string;
  teamId: string;
  createdBy: string;
  name: string;
  address: string;
  description: string;
  status: "uploading" | "generating" | "ready" | "failed";
  operationId?: string;
  worldId?: string;
  thumbnailUrl?: string;
  panoramaUrl?: string;
  splatUrl?: string;
  splatUrl500k?: string;
  splatUrl100k?: string;
  meshUrl?: string;
  marbleUrl?: string;
  originalImageUrl?: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export async function getAllSpaces(teamId?: string): Promise<Space[]> {
  let query: FirebaseFirestore.Query = db.collection(COLLECTION);
  if (teamId) {
    query = query.where("teamId", "==", teamId);
  }
  const snapshot = await query.orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => doc.data() as Space);
}

export async function getSpace(id: string): Promise<Space | undefined> {
  const doc = await db.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as Space) : undefined;
}

export async function createSpace(space: Space): Promise<Space> {
  await db.collection(COLLECTION).doc(space.id).set(space);
  return space;
}

export async function updateSpace(id: string, updates: Partial<Space>): Promise<Space | null> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const merged = { ...doc.data(), ...updates, updatedAt: new Date().toISOString() };
  await ref.set(merged, { merge: true });
  return merged as Space;
}

export async function deleteSpace(id: string): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

export async function getSpacesByIds(ids: string[]): Promise<Space[]> {
  if (ids.length === 0) return [];
  const results: Space[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snapshot = await db
      .collection(COLLECTION)
      .where("__name__", "in", chunk)
      .get();
    results.push(...snapshot.docs.map((doc) => doc.data() as Space));
  }
  return results;
}
