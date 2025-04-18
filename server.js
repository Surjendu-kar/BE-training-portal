import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? "https://iqnaut-training-portal.web.app"
        : "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
import testRoutes from "./routes/test.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import authRoutes from "./routes/auth.routes.js";
import roleRoutes from "./routes/role.routes.js";
import courseRoutes from "./routes/course.routes.js";
import batchRoutes from "./routes/batch.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import enrollmentRoutes from "./routes/enrollment.routes.js";
import assignmentRoutes from "./routes/assignment.routes.js";
import rankingRoutes from "./routes/ranking.routes.js";

// Apply routes
app.use("/api/test", testRoutes);
app.use("/api", uploadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/assignment", assignmentRoutes);
app.use("/api/ranking", rankingRoutes);

// Basic route
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
