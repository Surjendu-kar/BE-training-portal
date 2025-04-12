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

    console.log(
      "Sending assignments:",
      assignments.map((a) => ({
        name: a.assignmentName,
        batchId: a.batchId,
      }))
    );

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

export default router;
