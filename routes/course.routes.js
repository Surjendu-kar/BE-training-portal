import express from "express";
import admin from "../config/firebase.config.js";
import authenticateUser from "../middlewares/auth.middleware.js";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import fs from "fs";

const router = express.Router();

// Reuse  existing upload middleware
const upload = multer({ dest: "uploads/" });

// Get all courses
router.get("/", async (req, res) => {
  try {
    const coursesRef = admin.firestore().collection("courses");
    const snapshot = await coursesRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const courses = [];
    snapshot.forEach((doc) => {
      courses.push({
        documentId: doc.id,
        ...doc.data(),
      });
    });

    res.status(200).json({
      success: true,
      data: courses,
    });
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch courses",
      error: error.message,
    });
  }
});

// Get course by ID
router.get("/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    if (!courseDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        documentId: courseDoc.id,
        ...courseDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error fetching course:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch course",
      error: error.message,
    });
  }
});

// Create a new course
router.post(
  "/",
  authenticateUser,
  upload.single("files.thumbnail"),
  async (req, res) => {
    try {
      // Parse the course data from the request body
      const courseData = JSON.parse(req.body.data);

      // Get user information from the request (set by authenticateUser middleware)
      const user = req.user || {};

      // Create a new course object with default values for any missing fields
      const newCourse = {
        title: courseData.title || "",
        instructor: courseData.instructor || "",
        courseStatus: courseData.courseStatus || "Draft",
        skill: courseData.skill || "",
        course_fee: parseFloat(courseData.course_fee) || 0,
        description: courseData.description || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: {
          uid: user.uid || null,
          email: user.email || null,
          // Only include role if it exists
          ...(user.role && { role: user.role }),
        },
      };

      // Handle thumbnail upload if provided
      if (req.file) {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "course_thumbnails",
        });

        // Add thumbnail data to the course
        newCourse.thumbnail = {
          public_id: result.public_id,
          url: result.secure_url,
          formats: {
            thumbnail: {
              url: result.secure_url,
            },
            large: {
              url: result.secure_url,
            },
          },
        };

        // Delete the temporary file
        fs.unlinkSync(req.file.path);
      }

      // Save to Firestore
      const courseRef = await admin
        .firestore()
        .collection("courses")
        .add(newCourse);

      // Get the new document
      const courseDoc = await courseRef.get();

      res.status(201).json({
        success: true,
        message: "Course created successfully",
        data: {
          documentId: courseDoc.id,
          ...courseDoc.data(),
        },
      });
    } catch (error) {
      console.error("Error creating course:", error);

      // Clean up the uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        success: false,
        message: "Failed to create course",
        error: error.message,
      });
    }
  }
);

// Update a course
router.put(
  "/:courseId",
  authenticateUser,
  upload.single("files.thumbnail"),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      // Check if course exists
      const courseDoc = await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .get();
      if (!courseDoc.exists) {
        return res.status(404).json({
          success: false,
          message: "Course not found",
        });
      }

      // Parse the course data from the request body
      const courseData = JSON.parse(req.body.data);

      // Add thumbnail data if a new image was uploaded
      if (req.file) {
        // If there's an existing thumbnail, delete it from Cloudinary
        const existingData = courseDoc.data();
        if (existingData.thumbnail && existingData.thumbnail.public_id) {
          await cloudinary.uploader.destroy(existingData.thumbnail.public_id);
        }

        // Upload new thumbnail to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "course_thumbnails",
        });

        // Delete the temporary file
        fs.unlinkSync(req.file.path);

        courseData.thumbnail = {
          url: result.secure_url,
          public_id: result.public_id,
          formats: {
            thumbnail: {
              url: result.secure_url,
            },
            large: {
              url: result.secure_url,
            },
          },
        };
      }

      // Add update timestamp
      courseData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      // Add updater info
      if (req.user) {
        courseData.updatedBy = {
          uid: req.user.uid,
          email: req.user.email,
          // Only include role if it exists
          ...(req.user.role && { role: req.user.role }),
        };
      }

      // Update in Firestore
      await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .update(courseData);

      // Get the updated document
      const updatedDoc = await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .get();

      res.status(200).json({
        success: true,
        message: "Course updated successfully",
        data: {
          documentId: updatedDoc.id,
          ...updatedDoc.data(),
        },
      });
    } catch (error) {
      console.error("Error updating course:", error);

      // Clean up the uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        success: false,
        message: "Failed to update course",
        error: error.message,
      });
    }
  }
);

// Delete a course
router.delete("/:courseId", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;

    // Check if course exists and get its data
    const courseDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Delete thumbnail from Cloudinary if it exists
    const courseData = courseDoc.data();
    if (courseData.thumbnail && courseData.thumbnail.public_id) {
      await cloudinary.uploader.destroy(courseData.thumbnail.public_id);
    }

    // Delete from Firestore
    await admin.firestore().collection("courses").doc(courseId).delete();

    res.status(200).json({
      success: true,
      message: "Course deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting course:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course",
      error: error.message,
    });
  }
});

// Upload endpoint for course images
router.post(
  "/upload",
  authenticateUser,
  upload.single("files"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "course_thumbnails",
      });

      // Delete the temporary file
      fs.unlinkSync(req.file.path);

      // Return the uploaded file information
      res.status(200).json([
        {
          id: result.public_id,
          name: req.file.originalname,
          url: result.secure_url,
          formats: {
            thumbnail: {
              url: result.secure_url,
            },
            large: {
              url: result.secure_url,
            },
          },
        },
      ]);
    } catch (error) {
      console.error("Error uploading file:", error);

      // Clean up the uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: error.message,
      });
    }
  }
);

export default router;
