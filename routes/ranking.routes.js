import express from "express";
import admin from "firebase-admin";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get rankings for a specific batch
router.get("/batch/:batchId", authenticateUser, async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "Batch ID is required",
      });
    }

    // Get all assignments
    const assignmentsRef = admin.firestore().collection("assignments");
    const assignmentsSnapshot = await assignmentsRef.get();

    if (assignmentsSnapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Process all assignments and collect submission data
    const traineesMap = new Map();

    assignmentsSnapshot.forEach((doc) => {
      const documentData = doc.data();

      const assignmentFields = Object.keys(documentData).filter(
        (key) => key !== "createdAt" && key !== "updatedAt" && key !== "batchId"
      );

      assignmentFields.forEach((field) => {
        const assignment = documentData[field];

        // Check if this assignment belongs to the requested batch
        if (
          assignment.batchId === batchId &&
          assignment.submissions &&
          assignment.submissions.length > 0
        ) {
          assignment.submissions.forEach((submission) => {
            const traineeId = submission.traineeId;

            if (!traineesMap.has(traineeId)) {
              traineesMap.set(traineeId, {
                traineeId,
                name: submission.name,
                email: submission.email,
                totalScore: 0,
                assignmentsCompleted: 0,
                totalPossibleMarks: 0,
                lastSubmission: new Date(0),
                submissions: [],
                assignmentNames: [],
              });
            }

            const traineeData = traineesMap.get(traineeId);
            traineeData.totalScore += parseInt(submission.score || "0");
            traineeData.assignmentsCompleted += 1;

            // Add to total possible marks instead of overwriting
            traineeData.totalPossibleMarks += parseInt(
              assignment.totalMarks || "0"
            );

            // Add assignment name if not already in the list
            if (!traineeData.assignmentNames.includes(field)) {
              traineeData.assignmentNames.push(field);
            }

            const submissionDate = new Date(submission.submittedAt);
            if (submissionDate > new Date(traineeData.lastSubmission)) {
              traineeData.lastSubmission = submission.submittedAt;
            }

            traineeData.submissions.push({
              assignmentName: field,
              score: submission.score,
              totalMarks: assignment.totalMarks,
              submittedAt: submission.submittedAt,
            });
          });
        }
      });
    });

    // Convert map to array and add average score
    const rankings = Array.from(traineesMap.values()).map((trainee) => ({
      ...trainee,
      averageScore: Math.round(
        (trainee.totalScore / trainee.totalPossibleMarks) * 100
      ),
    }));

    // Sort by total score (descending)
    rankings.sort((a, b) => b.totalScore - a.totalScore);

    res.status(200).json({
      success: true,
      data: rankings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch batch rankings",
      error: error.message,
    });
  }
});

// Get rankings for a specific assignment
router.get(
  "/assignment/:documentId/:assignmentName",
  authenticateUser,
  async (req, res) => {
    try {
      const { documentId, assignmentName } = req.params;

      if (!documentId || !assignmentName) {
        return res.status(400).json({
          success: false,
          message: "Document ID and assignment name are required",
        });
      }

      // Get the assignment document
      const docRef = admin
        .firestore()
        .collection("assignments")
        .doc(documentId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message: "Assignment document not found",
        });
      }

      const documentData = doc.data();

      if (!documentData[assignmentName]) {
        return res.status(404).json({
          success: false,
          message: "Assignment not found in document",
        });
      }

      const assignment = documentData[assignmentName];

      if (!assignment.submissions || assignment.submissions.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      // Sort submissions by score (descending)
      const rankings = [...assignment.submissions].sort(
        (a, b) => b.score - a.score
      );

      res.status(200).json({
        success: true,
        data: rankings,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch assignment rankings",
        error: error.message,
      });
    }
  }
);

export default router;
