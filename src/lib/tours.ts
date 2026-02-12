import { db } from "./firebase";

const COLLECTION = "tours";

export interface TourRoom {
  spaceId: string;
  label: string;
  order: number;
}

export interface Tour {
  id: string;
  teamId: string;
  createdBy: string;
  name: string;
  address: string;
  description: string;
  rooms: TourRoom[];
  isPublic: boolean;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAllTours(teamId?: string): Promise<Tour[]> {
  let query: FirebaseFirestore.Query = db.collection(COLLECTION);
  if (teamId) {
    query = query.where("teamId", "==", teamId);
  }
  const snapshot = await query.orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => doc.data() as Tour);
}

export async function getTour(id: string): Promise<Tour | undefined> {
  const doc = await db.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as Tour) : undefined;
}

export async function createTour(tour: Tour): Promise<Tour> {
  await db.collection(COLLECTION).doc(tour.id).set(tour);
  return tour;
}

export async function updateTour(id: string, updates: Partial<Tour>): Promise<Tour | null> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const merged = { ...doc.data(), ...updates, updatedAt: new Date().toISOString() };
  await ref.set(merged, { merge: true });
  return merged as Tour;
}

export async function deleteTour(id: string): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

export async function addRoomToTour(tourId: string, room: TourRoom): Promise<Tour | null> {
  return db.runTransaction(async (txn) => {
    const ref = db.collection(COLLECTION).doc(tourId);
    const doc = await txn.get(ref);
    if (!doc.exists) return null;
    const tour = doc.data() as Tour;
    const rooms = [...tour.rooms.filter((r) => r.spaceId !== room.spaceId), room];
    rooms.sort((a, b) => a.order - b.order);
    const updates = { rooms, updatedAt: new Date().toISOString() };
    txn.update(ref, updates);
    return { ...tour, ...updates };
  });
}

export async function removeRoomFromTour(tourId: string, spaceId: string): Promise<Tour | null> {
  return db.runTransaction(async (txn) => {
    const ref = db.collection(COLLECTION).doc(tourId);
    const doc = await txn.get(ref);
    if (!doc.exists) return null;
    const tour = doc.data() as Tour;
    const rooms = tour.rooms.filter((r) => r.spaceId !== spaceId);
    const updates = { rooms, updatedAt: new Date().toISOString() };
    txn.update(ref, updates);
    return { ...tour, ...updates };
  });
}

export async function getTourByToken(token: string): Promise<Tour | undefined> {
  const snapshot = await db
    .collection(COLLECTION)
    .where("shareToken", "==", token)
    .limit(1)
    .get();
  return snapshot.empty ? undefined : (snapshot.docs[0].data() as Tour);
}
