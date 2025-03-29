import cloudinary from "../config/cloudinary.config.js";
import fs from "fs";

const uploadController = {
  uploadImage: async (req, res) => {
    try {
      // Check if file exists in the request
      if (!req.file) {
        return res.status(400).json({
          message: "No image file provided",
          error: "Image file is required",
        });
      }

      console.log("Attempting to upload to Cloudinary...");

      // Upload the image to Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "uploads",
        resource_type: "auto", // Automatically detect the file type
      });

      console.log("Cloudinary upload result:", result);

      // Remove the temporary file
      fs.unlinkSync(req.file.path);

      res.status(200).json({
        message: "Upload successful",
        imageUrl: result.secure_url,
        publicId: result.public_id,
      });
    } catch (error) {
      console.error("Cloudinary upload error:", error);

      // Clean up the file if it exists
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        message: "Upload failed",
        error: error.message,
      });
    }
  },
};

export default uploadController;
