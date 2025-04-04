import express from "express";
import admin from "../config/firebase.config.js";
import authenticateUser from "../middlewares/auth.middleware.js";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import fs from "fs";
import { body, validationResult } from "express-validator";

const router = express.Router();

// Reuse  existing upload middleware
const upload = multer({ dest: "uploads/" });

// Get all courses
router.get("/", authenticateUser, async (req, res) => {
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

//course Details

//update course sections
router.put(
  "/:courseId/sections",
  authenticateUser,
  [
    // Validate the section type
    body("sectionType")
      .isIn(["description", "about", "outcomes", "courses", "course_info"])
      .withMessage("Invalid section type"),

    // Validate the section data exists
    body("sectionData").notEmpty().withMessage("Section data is required"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: errors.array(),
        });
      }

      const { courseId } = req.params;
      const { sectionType, sectionData } = req.body;

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

      // Create update object with the specific section
      const updateData = {
        [sectionType]: sectionData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Add updater info if available
      if (req.user) {
        updateData.updatedBy = {
          uid: req.user.uid,
          email: req.user.email,
          ...(req.user.role && { role: req.user.role }),
        };
      }

      // Update the course
      await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .update(updateData);

      // Get the updated document
      const updatedDoc = await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .get();

      res.status(200).json({
        success: true,
        message: `Course ${sectionType} updated successfully`,
        data: {
          documentId: updatedDoc.id,
          ...updatedDoc.data(),
        },
      });
    } catch (error) {
      console.error(`Error updating course section:`, error);
      res.status(500).json({
        success: false,
        message: `Failed to update course section`,
        error: error.message,
      });
    }
  }
);

// Add a specific endpoint for the about section
router.put("/:courseId/about", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { about } = req.body;

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

    // Validate about data
    if (!about) {
      return res.status(400).json({
        success: false,
        message: "About data is required",
      });
    }

    // Parse about data if it's a string
    let aboutData = about;
    if (typeof about === "string") {
      try {
        aboutData = JSON.parse(about);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid about data format",
          error: e.message,
        });
      }
    }

    // Create update object
    const updateData = {
      about: aboutData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course about section updated successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error updating course about section:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course about section",
      error: error.message,
    });
  }
});

// Update course description
router.put("/:courseId/description", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { description } = req.body;

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

    // Create update object
    const updateData = {
      description: description || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course description updated successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error updating course description:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course description",
      error: error.message,
    });
  }
});

// Add a specific endpoint for the outcomes section
router.put("/:courseId/outcomes", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { outcomes } = req.body;

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

    // Validate outcomes data
    if (!outcomes) {
      return res.status(400).json({
        success: false,
        message: "Outcomes data is required",
      });
    }

    // Parse outcomes data if it's a string
    let outcomesData = outcomes;
    if (typeof outcomes === "string") {
      try {
        outcomesData = JSON.parse(outcomes);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid outcomes data format",
          error: e.message,
        });
      }
    }

    // Create update object
    const updateData = {
      outcomes: outcomesData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course outcomes updated successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error updating course outcomes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course outcomes",
      error: error.message,
    });
  }
});

// Add a specific endpoint for the course_info section
router.put("/:courseId/course_info", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { course_info } = req.body;

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

    // Validate course_info data
    if (!course_info) {
      return res.status(400).json({
        success: false,
        message: "Course info data is required",
      });
    }

    // Parse course_info data if it's a string
    let courseInfoData = course_info;
    if (typeof course_info === "string") {
      try {
        courseInfoData = JSON.parse(course_info);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Invalid course info data format",
          error: e.message,
        });
      }
    }

    // Create update object
    const updateData = {
      course_info: courseInfoData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course info updated successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error updating course info:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course info",
      error: error.message,
    });
  }
});

// Delete a specific section of a course
router.delete(
  "/:courseId/sections/:sectionType",
  authenticateUser,
  async (req, res) => {
    try {
      const { courseId, sectionType } = req.params;

      // Validate section type
      const validSections = [
        "description",
        "about",
        "outcomes",
        "courses",
        "course_info",
      ];
      if (!validSections.includes(sectionType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid section type",
        });
      }

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

      // Create update object with empty value based on section type
      let updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Set appropriate empty value based on section type
      switch (sectionType) {
        case "description":
          updateData.description = "";
          break;
        case "about":
          updateData.about = { paragraphs: [] };
          break;
        case "outcomes":
          updateData.outcomes = { intro: "", items: [] };
          break;
        case "courses":
          updateData.courses = { modules: [] };
          break;
        case "course_info":
          updateData.course_info = {
            months: "",
            weeklyHours: "",
            schedule: "",
            pace: "",
            credential: "",
          };
          break;
      }

      // Add updater info if available
      if (req.user) {
        updateData.updatedBy = {
          uid: req.user.uid,
          email: req.user.email,
          ...(req.user.role && { role: req.user.role }),
        };
      }

      // Update the course
      await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .update(updateData);

      // Get the updated document
      const updatedDoc = await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .get();

      res.status(200).json({
        success: true,
        message: `Course ${sectionType} deleted successfully`,
        data: {
          documentId: updatedDoc.id,
          ...updatedDoc.data(),
        },
      });
    } catch (error) {
      console.error(`Error deleting course section:`, error);
      res.status(500).json({
        success: false,
        message: `Failed to delete course section`,
        error: error.message,
      });
    }
  }
);

// Specific endpoints for deleting individual sections
// Delete course description
router.delete("/:courseId/description", authenticateUser, async (req, res) => {
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

    // Create update object
    const updateData = {
      description: "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course description deleted successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error deleting course description:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course description",
      error: error.message,
    });
  }
});

// Delete course about section
router.delete("/:courseId/about", authenticateUser, async (req, res) => {
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

    // Create update object
    const updateData = {
      about: { paragraphs: [] },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course about section deleted successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error deleting course about section:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course about section",
      error: error.message,
    });
  }
});

// Delete course outcomes section
router.delete("/:courseId/outcomes", authenticateUser, async (req, res) => {
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

    // Create update object
    const updateData = {
      outcomes: { intro: "", items: [] },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course outcomes deleted successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error deleting course outcomes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course outcomes",
      error: error.message,
    });
  }
});

// Delete course_info section
router.delete("/:courseId/course_info", authenticateUser, async (req, res) => {
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

    // Create update object with empty course_info
    const updateData = {
      course_info: {
        months: "",
        weeklyHours: "",
        schedule: "",
        pace: "",
        credential: "",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course info deleted successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error deleting course info:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course info",
      error: error.message,
    });
  }
});

// Update course modules
router.put("/:courseId/modules", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { modules } = req.body; // Extract modules from the request body

    // Validate modules data
    if (!modules || !Array.isArray(modules)) {
      return res.status(400).json({
        success: false,
        message: "Invalid modules data. Modules must be an array.",
      });
    }

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

    // Add updater info
    const updateData = {
      modules: modules,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add user info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course modules updated successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error updating course modules:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course modules",
      error: error.message,
    });
  }
});

// Delete course modules
router.delete("/:courseId/modules", authenticateUser, async (req, res) => {
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

    // Create update object with empty modules array
    const updateData = {
      modules: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add updater info if available
    if (req.user) {
      updateData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      };
    }

    // Update the course
    await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .update(updateData);

    // Get the updated document
    const updatedDoc = await admin
      .firestore()
      .collection("courses")
      .doc(courseId)
      .get();

    res.status(200).json({
      success: true,
      message: "Course modules deleted successfully",
      data: {
        documentId: updatedDoc.id,
        ...updatedDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error deleting course modules:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete course modules",
      error: error.message,
    });
  }
});

// Get course modules
router.get("/:courseId/modules", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;

    const courseRef = admin.firestore().collection("courses").doc(courseId);
    const courseDoc = await courseRef.get();

    if (!courseDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const courseData = courseDoc.data();

    // Return the modules data if it exists
    res.status(200).json({
      success: true,
      data: courseData.modules || [],
    });
  } catch (error) {
    console.error("Error getting course modules:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get course modules",
      error: error.message,
    });
  }
});

export default router;
