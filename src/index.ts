import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth";
import teamsRoutes from "./routes/teams";
import spacesRoutes from "./routes/spaces";
import toursRoutes from "./routes/tours";
import generateRoutes from "./routes/generate";
import statusRoutes from "./routes/status";
import publicRoutes from "./routes/public";
import floorplanRoutes from "./routes/floorplan";
import billingRoutes from "./routes/billing";

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy for correct client IP
app.set("trust proxy", 1);

// Security headers (allow popups for Firebase Auth)
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// Gzip compression
app.use(compression());

// CORS — multi-origin support
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  process.env.DISPLAY_URL,
  process.env.LANDING_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`⚠️ CORS blocked request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(cookieParser());

// Raw body for Stripe webhook (must be before express.json)
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "1mb" }));

// Rate limiting — general API
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", limiter);

// Rate limit for auth (higher since onAuthStateChanged fires on every navigation)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/auth/session", authLimiter);

// Stricter rate limit for generation (expensive)
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Generation limit reached, please try again later" },
});
app.use("/api/generate", generateLimiter);

// Rate limit for floor plan generation (public, tight limit per IP)
const floorplanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Floor plan generation limit reached, please try again later" },
});
app.use("/api/floor-plan", floorplanLimiter);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/spaces", spacesRoutes);
app.use("/api/tours", toursRoutes);
app.use("/api/generate", generateRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/t", publicRoutes);
app.use("/api/floor-plan", floorplanRoutes);
app.use("/api/billing", billingRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  console.log("💚 Health check pinged");
  res.json({ status: "ok" });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Validate required env vars
const requiredVars = ["FIREBASE_STORAGE_BUCKET"];
const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
if (!hasServiceAccount) {
  requiredVars.push("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY");
}
for (const v of requiredVars) {
  if (!process.env[v]) {
    console.error(`❌ Missing required environment variable: ${v}`);
    process.exit(1);
  }
}

console.log(`🚀 Environment validated — ${requiredVars.length} required vars OK`);
console.log(`🚀 Allowed CORS origins: ${allowedOrigins.join(", ")}`);

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🚀 SIGTERM received, shutting down gracefully...");
  server.close(() => process.exit(0));
});
