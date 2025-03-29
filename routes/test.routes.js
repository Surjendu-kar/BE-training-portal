import express from "express";
const router = express.Router();
import authenticateUser from "../middlewares/auth.middleware.js";

// Protected route that requires authentication
router.get("/protected", authenticateUser, (req, res) => {
  res.status(200).json({
    message: "Authentication successful",
    user: req.user,
  });
});

// Public route for comparison
router.get("/public", (req, res) => {
  res.status(200).json({
    message: "This is a public endpoint",
  });
});

export default router;
