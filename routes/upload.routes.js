import express from "express";
import multer from "multer";
import path from "path";
import uploadController from "../controllers/upload.controller.js";
import authenticateUser from "../middlewares/auth.middleware.js";
import fs from "fs";

const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // Make sure this directory exists
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

// File filter to only accept images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! Please upload only images."), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // Reduced to 2MB limit to avoid timeouts
  },
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

// Add authenticateUser middleware to protect the upload route
router.post("/upload", upload.single("image"), uploadController.uploadImage);

export default router;
