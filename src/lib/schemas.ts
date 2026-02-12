import { z } from "zod";

// Spaces
export const createSpaceSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).default(""),
  description: z.string().max(2000).default(""),
  imageCount: z.number().int().min(1).max(50).default(1),
});

export const updateSpaceSchema = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().max(500),
    description: z.string().max(2000),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field required");

// Tours
export const createTourSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).default(""),
  description: z.string().max(2000).default(""),
});

export const updateTourSchema = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().max(500),
    description: z.string().max(2000),
    isPublic: z.boolean(),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field required");

// Rooms
export const addRoomSchema = z.object({
  spaceId: z.string().min(1),
  label: z.string().min(1).max(200),
});

// Onboarding
export const onboardingSchema = z.object({
  businessType: z.enum([
    "solo_agent",
    "agency",
    "property_management",
    "other",
  ]),
});

// Session
export const sessionSchema = z.object({
  token: z.string().min(1),
});

// Teams
export const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
});

export const joinTeamSchema = z.object({
  inviteCode: z.string().min(1).max(20),
});

export const switchTeamSchema = z.object({
  teamId: z.string().min(1),
});

export const updateInviteSchema = z.object({
  enabled: z.boolean(),
});

// Profile
export const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    phone: z.string().max(50),
    companyName: z.string().max(200),
    businessType: z.enum(["solo_agent", "agency", "property_management", "other"]),
  })
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field required");
