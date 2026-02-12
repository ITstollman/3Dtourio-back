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
      const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
      console.log(`🔐 Token verified (Bearer) — user ${decoded.uid}`);
      return decoded;
    } catch {
      console.log("⚠️ Bearer token verification failed");
      return null;
    }
  }

  const session = req.cookies?.session;
  if (session) {
    try {
      const decoded = await getAuth().verifySessionCookie(session, true);
      console.log(`🔐 Session cookie verified — user ${decoded.uid}`);
      return decoded;
    } catch {
      console.log("⚠️ Session cookie verification failed (expired or invalid)");
      return null;
    }
  }

  console.log("⚠️ No auth credentials provided (no Bearer token or session cookie)");
  return null;
}

export async function resolveAuthContext(
  req: Request
): Promise<AuthContext | null> {
  const decoded = await verifyAuthToken(req);
  if (!decoded) return null;

  const teamId = req.headers["x-team-id"] as string | undefined;
  if (!teamId) {
    console.log(`⚠️ Missing x-team-id header — user ${decoded.uid}`);
    return null;
  }

  const teamDoc = await db.collection("teams").doc(teamId).get();
  if (!teamDoc.exists) {
    console.log(`⚠️ Team ${teamId} not found — user ${decoded.uid}`);
    return null;
  }

  const team = teamDoc.data();
  if (!team?.memberIds?.includes(decoded.uid)) {
    console.log(`⚠️ User ${decoded.uid} is not a member of team ${teamId}`);
    return null;
  }

  console.log(`🔐 Auth context resolved — user ${decoded.uid}, team ${teamId}`);
  return { uid: decoded.uid, teamId };
}
