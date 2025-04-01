import express from "express";
import admin from "firebase-admin";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get all batches
router.get("/", authenticateUser, async (req, res) => {
  try {
    const batchesRef = admin.firestore().collection("batches");
    const snapshot = await batchesRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const batchGroups = {};

    // First, group batches by document ID
    snapshot.forEach((doc) => {
      const batchData = doc.data();
      const documentId = doc.id;

      // Extract batch-specific fields (any field with a hyphen that contains a suffix)
      const batchFields = Object.keys(batchData).filter(
        (key) =>
          key.includes("-") &&
          batchData[key] &&
          typeof batchData[key] === "object" &&
          batchData[key].suffix
      );

      // Create a group entry for this document
      batchGroups[documentId] = {
        documentId: documentId,
        batchName: documentId,
        courseId: batchData.courseId,
        courseName: batchData.courseName,
        status: batchData.status,
        batches: [],
        createdAt: batchData.createdAt,
        updatedAt: batchData.updatedAt,
      };

      // Add each batch to the group
      batchFields.forEach((batchKey) => {
        const batchInfo = batchData[batchKey];

        if (batchInfo && batchInfo.suffix) {
          batchGroups[documentId].batches.push({
            batchId: batchKey,
            suffix: batchInfo.suffix,
            enrollLimit: batchInfo.enrollLimit || 0,
            trainingStartDate: batchInfo.trainingStartDate || null,
            trainingEndDate: batchInfo.trainingEndDate || null,
            internshipStartDate: batchInfo.internshipStartDate || null,
            internshipEndDate: batchInfo.internshipEndDate || null,
          });
        }
      });

      // Sort batches by suffix (A, B, C, etc.)
      batchGroups[documentId].batches.sort((a, b) => {
        return a.suffix.localeCompare(b.suffix);
      });
    });

    // Convert groups to array
    const batches = Object.values(batchGroups);

    res.status(200).json({
      success: true,
      data: batches,
    });
  } catch (error) {
    console.error("Error getting batches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get batches",
      error: error.message,
    });
  }
});

// Get a batch by ID
router.get("/:batchId", authenticateUser, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Extract the base document ID (without the suffix)
    // For example, from "B-FD-25-A" extract "B-FD-25"
    const parts = batchId.split("-");
    const baseDocumentId = parts.slice(0, 3).join("-"); // Get "B-FD-25"
    const suffix = parts[parts.length - 1]; // Get the suffix (A, B, C, etc.)

    const docRef = admin.firestore().collection("batches").doc(baseDocumentId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const batchData = docSnap.data();

    // Find the specific batch field with this suffix
    let batchField = null;
    let batchKey = null;

    Object.keys(batchData).forEach((key) => {
      if (
        key.includes("-") &&
        batchData[key] &&
        typeof batchData[key] === "object" &&
        batchData[key].suffix === suffix
      ) {
        batchField = batchData[key];
        batchKey = key;
      }
    });

    if (!batchField) {
      return res.status(404).json({
        success: false,
        message: "Batch with this suffix not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        documentId: baseDocumentId,
        batchId: `${baseDocumentId}-${suffix}`,
        batchName: batchKey, // Use the full key as the batch name
        courseId: batchData.courseId || "",
        courseName: batchData.courseName || "",
        status: batchData.status || "Upcoming",
        suffix: suffix,
        enrollLimit: batchField.enrollLimit || 0,
        trainingStartDate: batchField.trainingStartDate || null,
        trainingEndDate: batchField.trainingEndDate || null,
        internshipStartDate: batchField.internshipStartDate || null,
        internshipEndDate: batchField.internshipEndDate || null,
        createdAt: batchData.createdAt || null,
        updatedAt: batchData.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Error getting batch:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get batch",
      error: error.message,
    });
  }
});

// Create a new batch with suffix
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { documentId, suffix, batchDetails, batchData } = req.body;

    if (!documentId || !suffix || !batchDetails || !batchData) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const docRef = admin.firestore().collection("batches").doc(documentId);
    const docSnap = await docRef.get();

    // Create a display batch field name with concatenated day-month format
    const trainingStartDate = admin.firestore.Timestamp.fromDate(
      new Date(batchDetails.trainingStartDate)
    );
    const internshipEndDate = admin.firestore.Timestamp.fromDate(
      new Date(batchDetails.internshipEndDate)
    );

    // Convert timestamps to dates for formatting
    const trainingStartDateObj = trainingStartDate.toDate();
    const internshipEndDateObj = internshipEndDate.toDate();

    const trainingStartDay = trainingStartDateObj
      .getDate()
      .toString()
      .padStart(2, "0");
    const trainingStartMonth = (trainingStartDateObj.getMonth() + 1)
      .toString()
      .padStart(2, "0");
    const internshipEndDay = internshipEndDateObj
      .getDate()
      .toString()
      .padStart(2, "0");
    const internshipEndMonth = (internshipEndDateObj.getMonth() + 1)
      .toString()
      .padStart(2, "0");

    // Extract course abbreviation from document ID
    const parts = documentId.split("-");
    const courseAbbr = parts[1];

    // Create the display field name using concatenated format
    const displayBatchKey = `B-${courseAbbr}-${trainingStartDay}${trainingStartMonth}-${internshipEndDay}${internshipEndMonth}-${suffix}`;

    // Convert date strings to Firestore timestamps
    const batchDetailsWithTimestamps = {
      ...batchDetails,
      trainingStartDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.trainingStartDate)
      ),
      trainingEndDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.trainingEndDate)
      ),
      internshipStartDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.internshipStartDate)
      ),
      internshipEndDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.internshipEndDate)
      ),
    };

    if (docSnap.exists) {
      // Document exists, update it with the new batch
      await docRef.update({
        [`${displayBatchKey}`]: {
          suffix: suffix,
          trainingStartDate: batchDetailsWithTimestamps.trainingStartDate,
          trainingEndDate: batchDetailsWithTimestamps.trainingEndDate,
          internshipStartDate: batchDetailsWithTimestamps.internshipStartDate,
          internshipEndDate: batchDetailsWithTimestamps.internshipEndDate,
          enrollLimit: batchDetailsWithTimestamps.enrollLimit,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Document doesn't exist, create it with the batch
      await docRef.set({
        courseId: batchData.courseId,
        courseName: batchData.courseName,
        status: batchData.status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        [`${displayBatchKey}`]: {
          suffix: suffix,
          trainingStartDate: batchDetailsWithTimestamps.trainingStartDate,
          trainingEndDate: batchDetailsWithTimestamps.trainingEndDate,
          internshipStartDate: batchDetailsWithTimestamps.internshipStartDate,
          internshipEndDate: batchDetailsWithTimestamps.internshipEndDate,
          enrollLimit: batchDetailsWithTimestamps.enrollLimit,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: "Batch created successfully",
    });
  } catch (error) {
    console.error("Error creating batch:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create batch",
      error: error.message,
    });
  }
});

// Update a batch with specific suffix
router.put("/:documentId/:suffix", authenticateUser, async (req, res) => {
  try {
    const { documentId, suffix } = req.params;
    const { batchDetails, batchData } = req.body;

    if (!batchDetails) {
      return res.status(400).json({
        success: false,
        message: "Missing batch details",
      });
    }

    const docRef = admin.firestore().collection("batches").doc(documentId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Batch document not found",
      });
    }

    // Find the existing field name that has this suffix
    const existingBatchData = docSnap.data();
    let oldBatchKey = null;

    Object.keys(existingBatchData).forEach((key) => {
      if (
        key.includes("-") &&
        existingBatchData[key] &&
        typeof existingBatchData[key] === "object" &&
        existingBatchData[key].suffix === suffix
      ) {
        oldBatchKey = key;
      }
    });

    if (!oldBatchKey) {
      return res.status(404).json({
        success: false,
        message: "Batch with this suffix not found",
      });
    }

    // Convert date strings to Firestore timestamps
    const batchDetailsWithTimestamps = {
      ...batchDetails,
      trainingStartDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.trainingStartDate)
      ),
      trainingEndDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.trainingEndDate)
      ),
      internshipStartDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.internshipStartDate)
      ),
      internshipEndDate: admin.firestore.Timestamp.fromDate(
        new Date(batchDetails.internshipEndDate)
      ),
    };

    // Create a new display batch field name with concatenated day-month format
    const trainingStartDateObj =
      batchDetailsWithTimestamps.trainingStartDate.toDate();
    const internshipEndDateObj =
      batchDetailsWithTimestamps.internshipEndDate.toDate();

    const trainingStartDay = trainingStartDateObj
      .getDate()
      .toString()
      .padStart(2, "0");
    const trainingStartMonth = (trainingStartDateObj.getMonth() + 1)
      .toString()
      .padStart(2, "0");
    const internshipEndDay = internshipEndDateObj
      .getDate()
      .toString()
      .padStart(2, "0");
    const internshipEndMonth = (internshipEndDateObj.getMonth() + 1)
      .toString()
      .padStart(2, "0");

    // Extract course abbreviation from document ID
    const parts = documentId.split("-");
    const courseAbbr = parts[1];

    // Create the new display field name using concatenated format
    const newBatchKey = `B-${courseAbbr}-${trainingStartDay}${trainingStartMonth}-${internshipEndDay}${internshipEndMonth}-${suffix}`;

    // Update batch data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // If the field name has changed, delete the old one and add the new one
    if (oldBatchKey !== newBatchKey) {
      updateData[oldBatchKey] = admin.firestore.FieldValue.delete();
      updateData[newBatchKey] = {
        suffix: suffix,
        trainingStartDate: batchDetailsWithTimestamps.trainingStartDate,
        trainingEndDate: batchDetailsWithTimestamps.trainingEndDate,
        internshipStartDate: batchDetailsWithTimestamps.internshipStartDate,
        internshipEndDate: batchDetailsWithTimestamps.internshipEndDate,
        enrollLimit: batchDetailsWithTimestamps.enrollLimit,
      };
    } else {
      // Otherwise just update the existing field
      updateData[newBatchKey] = {
        suffix: suffix,
        trainingStartDate: batchDetailsWithTimestamps.trainingStartDate,
        trainingEndDate: batchDetailsWithTimestamps.trainingEndDate,
        internshipStartDate: batchDetailsWithTimestamps.internshipStartDate,
        internshipEndDate: batchDetailsWithTimestamps.internshipEndDate,
        enrollLimit: batchDetailsWithTimestamps.enrollLimit,
      };
    }

    // Update common batch group data if provided
    if (batchData) {
      if (batchData.courseId) updateData.courseId = batchData.courseId;
      if (batchData.courseName) updateData.courseName = batchData.courseName;
      if (batchData.status) updateData.status = batchData.status;
    }

    await docRef.update(updateData);

    res.status(200).json({
      success: true,
      message: "Batch updated successfully",
    });
  } catch (error) {
    console.error("Error updating batch:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update batch",
      error: error.message,
    });
  }
});

// Delete a batch with specific suffix
router.delete("/:documentId/:suffix", authenticateUser, async (req, res) => {
  try {
    const { documentId, suffix } = req.params;

    const docRef = admin.firestore().collection("batches").doc(documentId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Batch document not found",
      });
    }

    const batchData = docSnap.data();

    // Find the field that corresponds to this batch suffix
    let batchKey = null;
    Object.keys(batchData).forEach((key) => {
      if (
        key.includes("-") &&
        batchData[key] &&
        typeof batchData[key] === "object" &&
        batchData[key].suffix === suffix
      ) {
        batchKey = key;
      }
    });

    if (!batchKey) {
      return res.status(404).json({
        success: false,
        message: "Batch with this suffix not found",
      });
    }

    // Get all batch fields to check if this is the only batch
    const batchFields = Object.keys(batchData).filter(
      (key) =>
        key.includes("-") &&
        batchData[key] &&
        typeof batchData[key] === "object" &&
        batchData[key].suffix
    );

    if (batchFields.length === 1 && batchFields[0] === batchKey) {
      // This is the only batch, delete the entire document
      await docRef.delete();
    } else {
      // There are other batches, just remove this one
      await docRef.update({
        [batchKey]: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.status(200).json({
      success: true,
      message: "Batch deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting batch:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete batch",
      error: error.message,
    });
  }
});

// Get completed lessons for a specific batch
router.get(
  "/:documentId/:suffix/lessons",
  authenticateUser,
  async (req, res) => {
    try {
      const { documentId, suffix } = req.params;

      const docRef = admin.firestore().collection("batches").doc(documentId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          success: false,
          message: "Batch document not found",
        });
      }

      const batchData = docSnap.data();

      // Find the specific batch field with this suffix
      let batchField = null;

      Object.keys(batchData).forEach((key) => {
        if (
          key.includes("-") &&
          batchData[key] &&
          typeof batchData[key] === "object" &&
          batchData[key].suffix === suffix
        ) {
          batchField = batchData[key];
        }
      });

      if (!batchField) {
        return res.status(404).json({
          success: false,
          message: "Batch with this suffix not found",
        });
      }

      // Return the completed lessons data if it exists
      res.status(200).json({
        success: true,
        data: batchField.completedLessons || {},
      });
    } catch (error) {
      console.error("Error getting batch completed lessons:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get batch completed lessons",
        error: error.message,
      });
    }
  }
);

// Update completed lessons for a specific batch
router.put(
  "/:documentId/:suffix/lessons",
  authenticateUser,
  async (req, res) => {
    try {
      const { documentId, suffix } = req.params;
      const { completedLessons } = req.body;

      if (!completedLessons) {
        return res.status(400).json({
          success: false,
          message: "Missing completed lessons data",
        });
      }

      const docRef = admin.firestore().collection("batches").doc(documentId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          success: false,
          message: "Batch document not found",
        });
      }

      // Find the existing field name that has this suffix
      const existingBatchData = docSnap.data();
      let batchKey = null;

      Object.keys(existingBatchData).forEach((key) => {
        if (
          key.includes("-") &&
          existingBatchData[key] &&
          typeof existingBatchData[key] === "object" &&
          existingBatchData[key].suffix === suffix
        ) {
          batchKey = key;
        }
      });

      if (!batchKey) {
        return res.status(404).json({
          success: false,
          message: "Batch with this suffix not found",
        });
      }

      // Update the batch with completed lessons data
      const updateData = {
        [`${batchKey}.completedLessons`]: completedLessons,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await docRef.update(updateData);

      res.status(200).json({
        success: true,
        message: "Batch completed lessons updated successfully",
      });
    } catch (error) {
      console.error("Error updating batch completed lessons:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update batch completed lessons",
        error: error.message,
      });
    }
  }
);

export default router;
