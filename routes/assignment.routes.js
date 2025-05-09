import express from "express";
import admin from "firebase-admin";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get all assignments
router.get("/", authenticateUser, async (req, res) => {
  try {
    const assignmentsRef = admin.firestore().collection("assignments");
    const snapshot = await assignmentsRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const assignments = [];
    for (const doc of snapshot.docs) {
      const documentData = doc.data();
      const documentFields = Object.keys(documentData);

      // For each assignment field in the document
      for (const field of documentFields) {
        // Skip metadata fields and the document-level batchId field
        if (
          field !== "createdAt" &&
          field !== "updatedAt" &&
          field !== "batchId"
        ) {
          // Include the assignment data and ensure batchId is included
          const assignmentData = documentData[field];

          // Make sure the batchId is properly included - use the document level one as fallback
          if (!assignmentData.batchId && documentData.batchId) {
            assignmentData.batchId = documentData.batchId;
          }

          assignments.push({
            documentId: doc.id,
            assignmentId: `${doc.id}-${field}`,
            assignmentName: field,
            ...assignmentData,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: assignments,
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assignments",
      error: error.message,
    });
  }
});

// Get assignments for a specific batch
router.get("/batch/:batchId", authenticateUser, async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "Batch ID is required",
      });
    }

    const assignmentsRef = admin.firestore().collection("assignments");

    // Query assignments by the batchId field in the assignment documents
    const snapshot = await assignmentsRef.where("batchId", "==", batchId).get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const assignments = [];
    snapshot.forEach((doc) => {
      const documentData = doc.data();
      const documentFields = Object.keys(documentData).filter(
        (key) => key !== "createdAt" && key !== "updatedAt" && key !== "batchId"
      );

      // For each assignment field in the document
      documentFields.forEach((field) => {
        // Only include assignments that match the requested batchId
        if (documentData[field].batchId === batchId) {
          assignments.push({
            documentId: doc.id,
            assignmentId: `${doc.id}-${field}`,
            assignmentName: field,
            ...documentData[field],
          });
        }
      });
    });

    res.status(200).json({
      success: true,
      data: assignments,
    });
  } catch (error) {
    console.error("Error fetching assignments for batch:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assignments for batch",
      error: error.message,
    });
  }
});

// Get a specific assignment by document ID and assignment name
router.get(
  "/:documentId/:assignmentName",
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

      res.status(200).json({
        success: true,
        data: {
          documentId,
          assignmentName,
          ...documentData[assignmentName],
        },
      });
    } catch (error) {
      console.error("Error fetching assignment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch assignment",
        error: error.message,
      });
    }
  }
);

// Create a new assignment
router.post("/", authenticateUser, async (req, res) => {
  try {
    const {
      assignmentName,
      courseId,
      courseName,
      batchId,
      duration,
      totalMarks,
      questions,
      assignmentDate,
      status,
    } = req.body;

    if (
      !assignmentName ||
      !courseId ||
      !batchId ||
      !questions ||
      !assignmentDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Format date for document ID: DD-MM-YY
    const dateParts = assignmentDate.split("-");
    if (dateParts.length !== 3) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Expected YYYY-MM-DD",
      });
    }

    const year = dateParts[0].slice(-2); // Get last 2 digits of year
    const month = dateParts[1];
    const day = dateParts[2];
    const formattedDate = `${day}-${month}-${year}`;

    // Create document ID: date-batchId
    const documentId = `${formattedDate}-${batchId}`;

    // Check if document already exists
    const docRef = admin.firestore().collection("assignments").doc(documentId);
    const doc = await docRef.get();

    const assignmentData = {
      courseId,
      courseName,
      batchId,
      duration,
      totalMarks,
      questions,
      assignmentDate,
      status: status || "Upcoming",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      },
    };

    if (doc.exists) {
      // Document exists, update it with the new assignment field
      const updateData = {
        [assignmentName]: assignmentData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only update batchId at document level if it doesn't exist yet
      if (!doc.data().batchId) {
        updateData.batchId = batchId;
      }

      await docRef.update(updateData);
    } else {
      // Document doesn't exist, create it with the assignment field
      const newDocData = {
        [assignmentName]: assignmentData,
        batchId, // Adding batchId at document level for querying
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await docRef.set(newDocData);
    }

    res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      data: {
        documentId,
        assignmentName,
        ...assignmentData,
      },
    });
  } catch (error) {
    console.error("Error creating assignment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create assignment",
      error: error.message,
    });
  }
});

// Update an assignment
router.put(
  "/:documentId/:assignmentName",
  authenticateUser,
  async (req, res) => {
    try {
      const { documentId, assignmentName } = req.params;
      const {
        courseId,
        courseName,
        batchId,
        duration,
        totalMarks,
        questions,
        assignmentDate,
        status,
      } = req.body;

      if (!documentId || !assignmentName) {
        return res.status(400).json({
          success: false,
          message: "Document ID and assignment name are required",
        });
      }

      // Check if document exists
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

      // Prepare update data
      const assignmentData = {
        ...documentData[assignmentName],
        ...(courseId && { courseId }),
        ...(courseName && { courseName }),
        ...(batchId && { batchId }),
        ...(duration && { duration }),
        ...(totalMarks && { totalMarks }),
        ...(questions && { questions }),
        ...(assignmentDate && { assignmentDate }),
        ...(status && { status }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: {
          uid: req.user.uid,
          email: req.user.email,
          ...(req.user.role && { role: req.user.role }),
        },
      };

      // Update document
      await docRef.update({
        [assignmentName]: assignmentData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({
        success: true,
        message: "Assignment updated successfully",
        data: {
          documentId,
          assignmentName,
          ...assignmentData,
        },
      });
    } catch (error) {
      console.error("Error updating assignment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update assignment",
        error: error.message,
      });
    }
  }
);

// Delete an assignment
router.delete(
  "/:documentId/:assignmentName",
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

      // Check if document exists
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

      // Check if this is the only assignment in the document
      const assignmentFields = Object.keys(documentData).filter(
        (key) => key !== "createdAt" && key !== "updatedAt" && key !== "batchId"
      );

      if (
        assignmentFields.length === 1 &&
        assignmentFields[0] === assignmentName
      ) {
        // This is the only assignment, delete the entire document
        await docRef.delete();
      } else {
        // There are other assignments, just delete this one field
        await docRef.update({
          [assignmentName]: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Get the assignment details (needed for courseId)
      const assignmentDetails = documentData[assignmentName];
      const courseId = assignmentDetails.courseId;
      const batchId = assignmentDetails.batchId;

      // If there are submissions, update the user_manage records
      if (
        assignmentDetails.submissions &&
        assignmentDetails.submissions.length > 0
      ) {
        try {
          // Get all trainees who submitted this assignment
          const submissions = assignmentDetails.submissions;

          // Process each trainee who submitted
          for (const submission of submissions) {
            const traineeId = submission.traineeId;

            // Get the user document
            const userRef = admin
              .firestore()
              .collection("user_manage")
              .doc(traineeId);
            const userDoc = await userRef.get();

            if (!userDoc.exists) {
              console.warn(
                `User ${traineeId} not found in user_manage collection`
              );
              continue;
            }

            const userData = userDoc.data();

            // Check if the user has the course
            if (!userData.courses || !userData.courses[courseId]) {
              console.warn(
                `Course ${courseId} not found for user ${traineeId}`
              );
              continue;
            }

            const courseData = userData.courses[courseId];

            // Check if user has assignmentHistory
            if (
              !courseData.assignmentHistory ||
              courseData.assignmentHistory.length === 0
            ) {
              continue;
            }

            // Remove this assignment from history
            const assignmentId = `${documentId}-${assignmentName}`;
            const updatedHistory = courseData.assignmentHistory.filter(
              (entry) => entry.assignmentId !== documentId
            );

            // Calculate new average score
            let averageScore = 0;
            if (updatedHistory.length > 0) {
              const totalScore = updatedHistory.reduce((sum, assignment) => {
                // Convert totalMarks to number, default to 0 if not a valid number
                const totalMarks = parseInt(assignment.totalMarks) || 0;

                // If total marks is 0, return current sum to avoid division by zero
                if (totalMarks === 0) return sum;

                // Calculate percentage for this assignment and add to sum
                return sum + (parseInt(assignment.score) / totalMarks) * 100;
              }, 0);

              // Calculate average score as percentage
              averageScore = Math.round(totalScore / updatedHistory.length);
            }

            // Update the user document
            await userRef.update({
              [`courses.${courseId}.assignmentHistory`]: updatedHistory,
              [`courses.${courseId}.averageScore`]: averageScore,
              [`courses.${courseId}.lastUpdated`]:
                admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        } catch (error) {
          console.error("Error updating user_manage records:", error);
          // Don't fail the whole request if this update fails
        }
      }

      res.status(200).json({
        success: true,
        message: "Assignment deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting assignment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete assignment",
        error: error.message,
      });
    }
  }
);

// Get user's batches
router.get("/user-batches", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email.toLowerCase();

    // Get all trainee documents
    const traineesRef = admin.firestore().collection("trainees");
    const snapshot = await traineesRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const userBatches = [];

    // Check each batch document for the user
    for (const doc of snapshot.docs) {
      const batchData = doc.data();
      const trainees = batchData.trainees || [];

      // Check if user exists in this batch - case insensitive email comparison
      const userInBatch = trainees.find(
        (trainee) =>
          trainee.userId === userId && trainee.email.toLowerCase() === userEmail
      );

      if (userInBatch) {
        userBatches.push({
          docId: doc.id,
          fullBatchId: userInBatch.batchId,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: userBatches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user's batches",
      error: error.message,
    });
  }
});

// Get assignments for trainee
router.get("/trainee", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email.toLowerCase();

    // First get user's batches
    const traineesRef = admin.firestore().collection("trainees");
    const snapshot = await traineesRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const userBatchIds = [];

    // Find all batches the user is enrolled in
    for (const doc of snapshot.docs) {
      const batchData = doc.data();
      const trainees = batchData.trainees || [];

      // Case insensitive email comparison
      const userInBatch = trainees.find(
        (trainee) =>
          trainee.userId === userId && trainee.email.toLowerCase() === userEmail
      );

      if (userInBatch) {
        userBatchIds.push({
          docId: doc.id,
          fullBatchId: userInBatch.batchId,
        });
      }
    }

    if (userBatchIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Get assignments for user's batches
    const assignmentsRef = admin.firestore().collection("assignments");
    const assignmentsSnapshot = await assignmentsRef.get();

    if (assignmentsSnapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const assignments = [];

    // Filter assignments by user's batches
    for (const doc of assignmentsSnapshot.docs) {
      const documentData = doc.data();
      const documentFields = Object.keys(documentData);

      for (const field of documentFields) {
        if (
          field !== "createdAt" &&
          field !== "updatedAt" &&
          field !== "batchId"
        ) {
          const assignmentData = documentData[field];

          // Check if this assignment is for one of user's batches
          const matchingBatch = userBatchIds.find(
            (batch) =>
              batch.docId === assignmentData.batchId ||
              batch.fullBatchId === assignmentData.batchId
          );

          if (matchingBatch) {
            assignments.push({
              documentId: doc.id,
              assignmentId: `${doc.id}-${field}`,
              assignmentName: field,
              ...assignmentData,
            });
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: assignments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch trainee assignments",
      error: error.message,
    });
  }
});

// Submit an assignment
router.post(
  "/:documentId/:assignmentName/submit",
  authenticateUser,
  async (req, res) => {
    try {
      const { documentId, assignmentName } = req.params;
      const { traineeId, email, name, selectedAnswers, score, submittedAt } =
        req.body;

      // More detailed validation
      const missingFields = [];
      if (!documentId) missingFields.push("documentId");
      if (!assignmentName) missingFields.push("assignmentName");
      if (!traineeId) missingFields.push("traineeId");
      if (!email) missingFields.push("email");
      if (!Array.isArray(selectedAnswers) || selectedAnswers.length === 0)
        missingFields.push("selectedAnswers");
      if (score === undefined || score === null) missingFields.push("score");

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

      // Get the assignment document
      const assignmentRef = admin
        .firestore()
        .collection("assignments")
        .doc(documentId);
      const doc = await assignmentRef.get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message: "Assignment not found",
        });
      }

      const assignmentData = doc.data();
      const assignment = assignmentData[assignmentName];

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Assignment not found",
        });
      }

      // Check if user has already submitted
      const submissions = assignment.submissions || [];
      const existingSubmission = submissions.find(
        (sub) => sub.traineeId === traineeId
      );

      if (existingSubmission) {
        return res.status(400).json({
          success: false,
          message: "You have already submitted this assignment",
        });
      }

      // Add submission to assignment document
      const updatedSubmissions = [
        ...submissions,
        {
          traineeId,
          email,
          name,
          selectedAnswers,
          score,
          submittedAt,
        },
      ];

      // Update assignment document
      await assignmentRef.update({
        [`${assignmentName}.submissions`]: updatedSubmissions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update trainee's scores in trainees collection
      const traineesRef = admin
        .firestore()
        .collection("trainees")
        .doc(assignment.batchId);
      const traineesDoc = await traineesRef.get();

      if (traineesDoc.exists) {
        const traineesData = traineesDoc.data();
        const trainees = traineesData.trainees || [];

        // Find and update the trainee's scores
        const updatedTrainees = trainees.map((trainee) => {
          if (trainee.userId === traineeId) {
            const scores = trainee.scores || [];
            scores.push({
              assignmentName,
              assignmentId: documentId,
              score: score.toString(),
              courseName: assignment.courseName,
              submittedAt,
            });
            return { ...trainee, scores };
          }
          return trainee;
        });

        // Update trainees document
        await traineesRef.update({
          trainees: updatedTrainees,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Update user_manage collection to store assignment history for calculating average score
      try {
        // Get the user document
        const userRef = admin
          .firestore()
          .collection("user_manage")
          .doc(traineeId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
          console.warn(`User ${traineeId} not found in user_manage collection`);
        } else {
          const userData = userDoc.data();

          // Check if the user has the course
          if (!userData.courses || !userData.courses[assignment.courseId]) {
            console.warn(
              `Course ${assignment.courseId} not found for user ${traineeId}`
            );
          } else {
            // Get the current course data for this user
            const courseData = userData.courses[assignment.courseId];

            // Initialize assignmentHistory if it doesn't exist
            if (!courseData.assignmentHistory)
              courseData.assignmentHistory = [];

            // Create assignment record
            const assignmentEntry = {
              assignmentId: documentId, // Only use documentId without assignment name
              assignmentName,
              totalMarks: assignment.totalMarks || 0,
              score,
              submittedAt: admin.firestore.Timestamp.fromDate(
                new Date(submittedAt)
              ),
              courseName: assignment.courseName,
            };

            // Check if assignment already exists in history
            const existingEntryIndex = courseData.assignmentHistory.findIndex(
              (entry) => entry.assignmentId === assignmentEntry.assignmentId
            );

            // If assignment already exists, update it; otherwise add it
            if (existingEntryIndex !== -1) {
              courseData.assignmentHistory[existingEntryIndex] =
                assignmentEntry;
            } else {
              courseData.assignmentHistory.push(assignmentEntry);
            }

            // Calculate average score with percentage
            const totalScore = courseData.assignmentHistory.reduce(
              (sum, assignment) => {
                // Convert totalMarks to number, default to 0 if not a valid number
                const totalMarks = parseInt(assignment.totalMarks) || 0;

                // If total marks is 0, return current sum to avoid division by zero
                if (totalMarks === 0) return sum;

                // Calculate percentage for this assignment and add to sum
                return sum + (parseInt(assignment.score) / totalMarks) * 100;
              },
              0
            );

            // Calculate average score as percentage
            const averageScore =
              courseData.assignmentHistory.length > 0
                ? Math.round(totalScore / courseData.assignmentHistory.length)
                : 0;

            // Update the user document
            await userRef.update({
              [`courses.${assignment.courseId}.assignmentHistory`]:
                courseData.assignmentHistory,
              [`courses.${assignment.courseId}.averageScore`]: averageScore,
              [`courses.${assignment.courseId}.lastUpdated`]:
                admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      } catch (error) {
        console.error(
          `Error updating assignment history for user ${traineeId}:`,
          error
        );
        // Don't fail the whole request if this update fails
      }

      res.status(200).json({
        success: true,
        message: "Assignment submitted successfully",
        data: {
          score,
          submittedAt,
        },
      });
    } catch (error) {
      console.error("Error submitting assignment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to submit assignment",
        error: error.message,
      });
    }
  }
);

export default router;
