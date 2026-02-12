const BASE_URL =
  process.env.WORLDLABS_BASE_URL || "https://api.worldlabs.ai/marble/v1";
const API_KEY = process.env.WORLDLABS_API_KEY || "";

interface WorldAssets {
  thumbnail_url?: string;
  caption?: string;
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
  panorama_url?: string;
}

interface World {
  world_id: string;
  display_name?: string;
  world_marble_url?: string;
  assets: WorldAssets;
}

interface Operation {
  operation_id: string;
  done: boolean;
  response?: {
    world_id: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`${BASE_URL}/${path}`, {
    ...options,
    headers: {
      "WLT-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      `${path}: ${response.status} ${JSON.stringify(body)}`
    );
  }

  return body;
}

export async function generateWorldFromImageBase64(
  imageBase64: string,
  textPrompt?: string,
  draft: boolean = false
): Promise<string> {
  const worldPrompt: Record<string, unknown> = {
    type: "image",
    text_prompt: textPrompt || null,
    disable_recaption: false,
    image_prompt: {
      source: "data_base64",
      data_base64: imageBase64,
    },
  };

  const operation = await apiFetch("worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      world_prompt: worldPrompt,
      model: draft ? "Marble 0.1-mini" : "Marble 0.1-plus",
    }),
  });

  return operation.operation_id;
}

export async function generateWorldFromText(
  textPrompt: string,
  draft: boolean = false
): Promise<string> {
  const worldPrompt = {
    type: "text",
    text_prompt: textPrompt,
    disable_recaption: false,
  };

  const operation = await apiFetch("worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      world_prompt: worldPrompt,
      model: draft ? "Marble 0.1-mini" : "Marble 0.1-plus",
    }),
  });

  return operation.operation_id;
}

export async function getOperation(operationId: string): Promise<Operation> {
  return await apiFetch(`operations/${operationId}`);
}

export async function getWorld(worldId: string): Promise<World> {
  return await apiFetch(`worlds/${worldId}`);
}

export async function listWorlds(): Promise<World[]> {
  const body = await apiFetch("worlds:list", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return body.worlds;
}

export type { WorldAssets, World, Operation };
