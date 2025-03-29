import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// Import routes
import testRoutes from "./routes/test.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

// Apply routes
app.use("/api/test", testRoutes);
app.use("/api", uploadRoutes); // This will make the upload endpoint available at /api/upload

// Basic route
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
