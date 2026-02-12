import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (getApps().length === 0) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
    credential = cert(sa);
  } else {
    credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    });
  }

  initializeApp({
    credential,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

export const db = getFirestore();
export const bucket = getStorage().bucket();

export async function uploadImage(
  buffer: Buffer,
  path: string,
  contentType = "image/jpeg"
): Promise<string> {
  const file = bucket.file(path);
  await file.save(buffer, { contentType, public: true });
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}
