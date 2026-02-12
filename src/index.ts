import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth";
import teamsRoutes from "./routes/teams";
import spacesRoutes from "./routes/spaces";
import toursRoutes from "./routes/tours";
import generateRoutes from "./routes/generate";
import statusRoutes from "./routes/status";
import publicRoutes from "./routes/public";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/spaces", spacesRoutes);
app.use("/api/tours", toursRoutes);
app.use("/api/generate", generateRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/t", publicRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
