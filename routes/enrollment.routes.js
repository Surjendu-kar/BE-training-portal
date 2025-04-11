import express from "express";
import admin from "firebase-admin";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Check if a user is enrolled in a specific course
router.get("/check/:courseId", authenticateUser, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.uid;

    if (!courseId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    // Check in enrollments collection first
    const enrollmentQuery = await admin
      .firestore()
      .collection("enrollments")
      .where("courseId", "==", courseId)
      .where("userId", "==", userId)
      .limit(1)
      .get();

    if (!enrollmentQuery.empty) {
      return res.status(200).json({
        success: true,
        enrolled: true,
        data: {
          enrollmentId: enrollmentQuery.docs[0].id,
          ...enrollmentQuery.docs[0].data(),
        },
      });
    }

    // If not found in enrollments, check trainees collection
    // Get all batches for this course
    const batchQuery = await admin
      .firestore()
      .collection("batches")
      .where("courseId", "==", courseId)
      .get();

    const batchIds = [];
    batchQuery.forEach((doc) => {
      const data = doc.data();

      // Extract batch-specific fields (any field with a hyphen that contains a suffix)
      const batchFields = Object.keys(data).filter(
        (key) =>
          key.includes("-") &&
          data[key] &&
          typeof data[key] === "object" &&
          data[key].suffix
      );

      batchFields.forEach((batchKey) => {
        batchIds.push(batchKey);
      });
    });

    // Now check if user is in any of these batches
    for (const batchId of batchIds) {
      const traineeDoc = await admin
        .firestore()
        .collection("trainees")
        .doc(batchId)
        .get();

      if (traineeDoc.exists) {
        const trainees = traineeDoc.data().trainees || [];
        const isEnrolled = trainees.some(
          (trainee) => trainee.userId === userId
        );

        if (isEnrolled) {
          return res.status(200).json({
            success: true,
            enrolled: true,
            data: {
              batchId,
              courseId,
            },
          });
        }
      }
    }

    // If we reach here, user is not enrolled
    return res.status(200).json({
      success: true,
      enrolled: false,
    });
  } catch (error) {
    console.error("Error checking enrollment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check enrollment status",
      error: error.message,
    });
  }
});

export default router;
