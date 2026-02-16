/**
 * Seed a complete property tour from local .spz files in propery-example/.
 * Uploads to Firebase Storage → creates Space + Tour docs in Firestore.
 *
 * Run: npx tsx scripts/seed-property-example.ts
 */

import "dotenv/config";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// --- Firebase init ---
const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID || "realestate3d-e3948",
    clientEmail:
      process.env.FIREBASE_CLIENT_EMAIL ||
      "firebase-adminsdk-fbsvc@realestate3d-e3948.iam.gserviceaccount.com",
    privateKey: (
      process.env.FIREBASE_PRIVATE_KEY || ""
    ).replace(/\\n/g, "\n"),
  }),
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    "realestate3d-e3948.firebasestorage.app",
});

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

const EXAMPLE_DIR = path.resolve(__dirname, "../../real-estate/propery-example");

const ROOMS = [
  { file: "world-hero.spz", label: "Living Room", name: "Living Room" },
  { file: "world-kitchen.spz", label: "Kitchen", name: "Kitchen" },
  { file: "world-bed.spz", label: "Bedroom", name: "Bedroom" },
];

async function main() {
  const tourId = `example-property-tour`;
  const shareToken = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const tourRooms: { spaceId: string; label: string; order: number }[] = [];

  console.log("=== Seeding Property Example Tour ===\n");

  for (let i = 0; i < ROOMS.length; i++) {
    const room = ROOMS[i];
    const spaceId = `example-${room.label.toLowerCase().replace(/\s+/g, "-")}`;
    const filePath = path.join(EXAMPLE_DIR, room.file);

    console.log(`--- ${room.label} ---`);

    // 1. Read local .spz file
    if (!fs.existsSync(filePath)) {
      console.error(`  ❌ File not found: ${filePath}`);
      process.exit(1);
    }
    const splatBuffer = fs.readFileSync(filePath);
    console.log(`  📦 Read ${(splatBuffer.length / 1024 / 1024).toFixed(1)} MB from ${room.file}`);

    // 2. Upload to Firebase Storage
    const storagePath = `models/${spaceId}/model.spz`;
    const file = bucket.file(storagePath);
    await file.save(splatBuffer, {
      contentType: "application/octet-stream",
      public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    console.log(`  ☁️  Uploaded to ${publicUrl}`);

    // 3. Create Space document
    const space = {
      id: spaceId,
      teamId: "example",
      createdBy: "system",
      name: room.name,
      address: "Example Property",
      description: "",
      status: "ready",
      splatUrl: publicUrl,
      splatUrl500k: publicUrl,
      splatUrl100k: publicUrl,
      imageCount: 0,
      imageUrls: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("spaces").doc(spaceId).set(space);
    console.log(`  💾 Space created: ${spaceId}`);

    tourRooms.push({ spaceId, label: room.label, order: i });
  }

  // 4. Create Tour document with all rooms
  const tour = {
    id: tourId,
    teamId: "example",
    createdBy: "system",
    name: "Example Property",
    address: "123 Example Street",
    description: "A complete property tour with living room, kitchen, and bedroom.",
    rooms: tourRooms,
    isPublic: true,
    shareToken,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("tours").doc(tourId).set(tour);

  console.log(`\n✅ Tour created: ${tourId}`);
  console.log(`🔗 Share token: ${shareToken}`);
  console.log(`\nUse this URL to view the tour:`);
  console.log(`  http://localhost:3002/t/${shareToken}`);
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
