import { Request } from "express";
import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import "./firebase";
import { db } from "./firebase";

export interface AuthContext {
  uid: string;
  teamId: string;
}

export async function verifyAuthToken(
  req: Request
): Promise<DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      return await getAuth().verifyIdToken(authHeader.slice(7));
    } catch {
      return null;
    }
  }

  const session = req.cookies?.session;
  if (session) {
    try {
      return await getAuth().verifySessionCookie(session, true);
    } catch {
      return null;
    }
  }

  return null;
}

export async function resolveAuthContext(
  req: Request
): Promise<AuthContext | null> {
  const decoded = await verifyAuthToken(req);
  if (!decoded) return null;

  const teamId = req.headers["x-team-id"] as string | undefined;
  if (!teamId) return null;

  const teamDoc = await db.collection("teams").doc(teamId).get();
  if (!teamDoc.exists) return null;

  const team = teamDoc.data();
  if (!team?.memberIds?.includes(decoded.uid)) return null;

  return { uid: decoded.uid, teamId };
}
