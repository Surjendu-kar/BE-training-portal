import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
import testRoutes from "./routes/test.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import authRoutes from "./routes/auth.routes.js";
import roleRoutes from "./routes/role.routes.js";
import courseRoutes from "./routes/course.routes.js";
import batchRoutes from "./routes/batch.routes.js";
// Apply routes
app.use("/api/test", testRoutes);
app.use("/api", uploadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/batches", batchRoutes);

// Basic route
app.get("/", (req, res) => {
  res.status(200).send("API is running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
