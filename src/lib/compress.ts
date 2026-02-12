import sharp from "sharp";
import { bucket } from "./firebase";

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToStorage(
  buffer: Buffer,
  path: string,
  contentType: string
): Promise<string> {
  const file = bucket.file(path);
  await file.save(buffer, { contentType, public: true });
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

async function compressImage(
  url: string,
  spaceId: string,
  name: string,
  maxWidth?: number
): Promise<string> {
  const raw = await downloadBuffer(url);
  let pipeline = sharp(raw);

  if (maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  const compressed = await pipeline.webp({ quality: 82 }).toBuffer();
  return uploadToStorage(compressed, `models/${spaceId}/${name}.webp`, "image/webp");
}

async function reuploadBinary(
  url: string,
  spaceId: string,
  name: string,
  contentType: string
): Promise<string> {
  const buffer = await downloadBuffer(url);
  return uploadToStorage(buffer, `models/${spaceId}/${name}`, contentType);
}

interface WorldAssets {
  thumbnail_url?: string;
  panorama_url?: string;
  splats?: {
    spz_urls?: {
      full_res?: string;
      "500k"?: string;
      "100k"?: string;
    };
  };
  mesh?: {
    glb_url?: string;
  };
}

interface CompressedUrls {
  thumbnailUrl?: string;
  panoramaUrl?: string;
  splatUrl?: string;
  splatUrl500k?: string;
  splatUrl100k?: string;
  meshUrl?: string;
}

export async function compressAndUploadAssets(
  spaceId: string,
  assets: WorldAssets
): Promise<CompressedUrls> {
  const tasks: Promise<void>[] = [];
  const result: CompressedUrls = {};

  if (assets.thumbnail_url) {
    tasks.push(
      compressImage(assets.thumbnail_url, spaceId, "thumbnail", 800).then(
        (url) => { result.thumbnailUrl = url; }
      )
    );
  }

  if (assets.panorama_url) {
    tasks.push(
      compressImage(assets.panorama_url, spaceId, "panorama").then(
        (url) => { result.panoramaUrl = url; }
      )
    );
  }

  const splatUrl =
    assets.splats?.spz_urls?.full_res ||
    assets.splats?.spz_urls?.["500k"] ||
    assets.splats?.spz_urls?.["100k"];

  if (splatUrl) {
    tasks.push(
      reuploadBinary(splatUrl, spaceId, "model.spz", "application/octet-stream").then(
        (url) => { result.splatUrl = url; }
      )
    );
  }

  if (assets.splats?.spz_urls?.["500k"]) {
    tasks.push(
      reuploadBinary(assets.splats.spz_urls["500k"], spaceId, "model-500k.spz", "application/octet-stream").then(
        (url) => { result.splatUrl500k = url; }
      )
    );
  }

  if (assets.splats?.spz_urls?.["100k"]) {
    tasks.push(
      reuploadBinary(assets.splats.spz_urls["100k"], spaceId, "model-100k.spz", "application/octet-stream").then(
        (url) => { result.splatUrl100k = url; }
      )
    );
  }

  if (assets.mesh?.glb_url) {
    tasks.push(
      reuploadBinary(assets.mesh.glb_url, spaceId, "model.glb", "model/gltf-binary").then(
        (url) => { result.meshUrl = url; }
      )
    );
  }

  await Promise.all(tasks);
  return result;
}
