import express from "express";
import admin from "firebase-admin";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get all attendance records
router.get("/", authenticateUser, async (req, res) => {
  try {
    const attendanceRef = admin.firestore().collection("attendance");
    const snapshot = await attendanceRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const attendanceRecords = [];
    snapshot.forEach((doc) => {
      attendanceRecords.push({
        documentId: doc.id,
        ...doc.data(),
      });
    });

    res.status(200).json({
      success: true,
      data: attendanceRecords,
    });
  } catch (error) {
    console.error("Error fetching attendance records:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attendance records",
      error: error.message,
    });
  }
});

// Get attendance record by ID
router.get("/:recordId", authenticateUser, async (req, res) => {
  try {
    const { recordId } = req.params;
    const recordDoc = await admin
      .firestore()
      .collection("attendance")
      .doc(recordId)
      .get();

    if (!recordDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        documentId: recordDoc.id,
        ...recordDoc.data(),
      },
    });
  } catch (error) {
    console.error("Error fetching attendance record:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attendance record",
      error: error.message,
    });
  }
});

// Create attendance record (acts as upsert - will update if record exists for same day and batch)
router.post("/", authenticateUser, async (req, res) => {
  try {
    const {
      courseId,
      batchId,
      studentDetails,
      documentId: providedDocumentId,
    } = req.body;

    if (!courseId || !batchId || !studentDetails) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Get course details
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

    // Get enrolled trainees for validation
    const traineesDoc = await admin
      .firestore()
      .collection("trainees")
      .doc(batchId)
      .get();

    if (!traineesDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "No trainees found for this batch",
      });
    }

    const enrolledTrainees = traineesDoc.data().trainees || [];
    const enrolledTraineeIds = new Set(
      enrolledTrainees.map((trainee) => trainee.userId)
    );

    // Validate that all students in attendance are enrolled trainees
    const invalidStudents = studentDetails.filter(
      (student) => !enrolledTraineeIds.has(student.studentId)
    );

    if (invalidStudents.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some students are not enrolled in this batch",
        invalidStudents: invalidStudents.map((student) => ({
          studentId: student.studentId,
          name: student.name,
        })),
      });
    }

    // Extract the batch details from the full batch ID
    // Example: Convert "B-N-0404-3009-A" to document ID "B-N-25" and suffix "A"
    const parts = batchId.split("-");

    // Try to construct the document ID based on the course prefix and number
    // The format in Firestore is "B-N-25", but the incoming batchId might have a different format
    const coursePrefix = parts[0]; // "B"
    const courseCode = parts[1]; // "N"
    const baseDocumentId = `${coursePrefix}-${courseCode}-25`; // Construct "B-N-25"
    const suffix = parts[parts.length - 1]; // Gets "A"

    // Get the batch document
    const batchDoc = await admin
      .firestore()
      .collection("batches")
      .doc(baseDocumentId)
      .get();

    if (!batchDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    // Get the batch data
    const batchData = batchDoc.data();

    // Look for the field with this batch ID in the document
    let batchDetails = null;

    // First try direct lookup
    if (batchData[batchId]) {
      batchDetails = batchData[batchId];
    }
    // Then try looking by suffix
    else {
      Object.entries(batchData).forEach(([key, value]) => {
        if (
          key.includes("-") &&
          value &&
          typeof value === "object" &&
          value.suffix === suffix
        ) {
          batchDetails = value;
          batchId = key;
        }
      });
    }

    if (!batchDetails) {
      return res.status(404).json({
        success: false,
        message: "Batch details not found",
      });
    }

    // Calculate attendance statistics
    const totalStudents = studentDetails.length;
    const presentStudents = studentDetails.filter(
      (student) => student.status === "Present"
    ).length;
    const absentStudents = totalStudents - presentStudents;

    // Create the attendance record
    const attendanceRecord = {
      courseId,
      courseName: courseDoc.data().title,
      batchId,
      totalStudents,
      presentStudents,
      absentStudents,
      studentDetails: studentDetails.map((student) => ({
        studentId: student.studentId,
        name: student.name,
        status: student.status || "Absent",
      })),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: {
        uid: req.user.uid,
        email: req.user.email,
        ...(req.user.role && { role: req.user.role }),
      },
    };

    // Determine the document ID to use
    let documentId;
    let todayDate = "";

    if (providedDocumentId) {
      // If documentId is provided, use it (update case)
      documentId = providedDocumentId;
      // Extract date part from the documentId (format: DD-MM-YY-batchId)
      todayDate = providedDocumentId.split("-").slice(0, 3).join("-"); // e.g. "10-04-25"
    } else {
      // Otherwise generate a new ID based on current date (create case)
      const today = new Date();
      const day = today.getDate().toString().padStart(2, "0");
      const month = (today.getMonth() + 1).toString().padStart(2, "0");
      const year = today.getFullYear().toString().slice(-2);

      todayDate = `${day}-${month}-${year}`;
      documentId = `${todayDate}-${batchId}`;
    }

    // Check if there's already an attendance record for today for this batch
    // We need to do this before creating/updating the current record
    // to determine if this is a new date's entry or just another entry for today
    let isNewDateRecord = false;
    let isFirstAttendanceForDay = true;

    // Extract the date part from the proposed documentId
    const datePartOfId = documentId.split("-").slice(0, 3).join("-"); // e.g. "10-04-25"

    // Check for any existing attendance records for the same date
    const existingRecordsQuery = await admin
      .firestore()
      .collection("attendance")
      .where("batchId", "==", batchId)
      .get();

    if (!existingRecordsQuery.empty) {
      existingRecordsQuery.forEach((doc) => {
        // Extract date part from existing document IDs
        const existingDocId = doc.id;
        const existingDatePart = existingDocId.split("-").slice(0, 3).join("-");

        // If the date matches our current operation date, this is not the first record for this day
        if (existingDatePart === datePartOfId && existingDocId !== documentId) {
          isFirstAttendanceForDay = false;
        }
      });
    }

    // Save to Firestore with the determined document ID
    const docRef = admin.firestore().collection("attendance").doc(documentId);
    const doc = await docRef.get();

    let existingData = null;

    if (doc.exists) {
      existingData = doc.data();

      // If document exists, update only necessary fields
      await docRef.update({
        courseId,
        courseName: courseDoc.data().title,
        batchId,
        totalStudents,
        presentStudents,
        absentStudents,
        studentDetails: studentDetails.map((student) => ({
          studentId: student.studentId,
          name: student.name,
          status: student.status || "Absent",
        })),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: {
          uid: req.user.uid,
          email: req.user.email,
          ...(req.user.role && { role: req.user.role }),
        },
      });

      // This is not a new date record, it's an update to an existing one
      isNewDateRecord = false;
    } else {
      // If document doesn't exist, create new with all fields
      await docRef.set({
        ...attendanceRecord,
      });

      // This is a new record, but we still need to check if it's the first for this day
      isNewDateRecord = isFirstAttendanceForDay;
    }

    // Create a batch to update all trainee attendance statistics
    const batch = admin.firestore().batch();
    const traineesRef = admin.firestore().collection("trainees").doc(batchId);

    // Create a map to track which students were present/absent
    const statusMap = {};
    studentDetails.forEach((student) => {
      statusMap[student.studentId] = student.status; // Store the actual status value "Present" or "Absent"
    });

    // Get the current trainees document to update their attendance stats
    const updatedTrainees = enrolledTrainees.map((trainee) => {
      // Skip update if this trainee isn't in the attendance record
      if (!statusMap.hasOwnProperty(trainee.userId)) {
        return trainee;
      }

      // Initialize attendance stats if they don't exist
      if (!trainee.totalPresent) trainee.totalPresent = 0;
      if (!trainee.totalAbsent) trainee.totalAbsent = 0;

      // If this is a new date record (first record for this day), count attendance
      if (isNewDateRecord) {
        // For a new date's attendance record, increment counters based on attendance status
        if (statusMap[trainee.userId] === "Present") {
          trainee.totalPresent += 1;
        } else {
          trainee.totalAbsent += 1;
        }
      }
      // If updating an existing record for the same date
      else if (existingData) {
        // Get the existing student detail to see if status changed
        const existingStudent = existingData.studentDetails.find(
          (s) => s.studentId === trainee.userId
        );

        if (existingStudent) {
          // If status changed from present to absent, decrement present and increment absent
          if (
            existingStudent.status === "Present" &&
            statusMap[trainee.userId] === "Absent"
          ) {
            trainee.totalPresent = Math.max(0, trainee.totalPresent - 1);
            trainee.totalAbsent += 1;
          }
          // If status changed from absent to present, increment present and decrement absent
          else if (
            existingStudent.status === "Absent" &&
            statusMap[trainee.userId] === "Present"
          ) {
            trainee.totalPresent += 1;
            trainee.totalAbsent = Math.max(0, trainee.totalAbsent - 1);
          }
          // If no change in status, do nothing
        }
      }

      return trainee;
    });

    // Update the trainees document with the new attendance statistics
    batch.update(traineesRef, {
      trainees: updatedTrainees,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Commit the batch operation
    await batch.commit();

    // Check if this was an update or create
    const isUpdate = doc.exists;

    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: `Attendance record ${
        isUpdate ? "updated" : "created"
      } successfully`,
      data: {
        documentId,
        ...attendanceRecord,
      },
    });
  } catch (error) {
    console.error("Error managing attendance record:", error);
    res.status(500).json({
      success: false,
      message: "Failed to manage attendance record",
      error: error.message,
    });
  }
});

// Delete attendance record
router.delete("/:recordId", authenticateUser, async (req, res) => {
  try {
    const { recordId } = req.params;

    // Check if record exists
    const recordDoc = await admin
      .firestore()
      .collection("attendance")
      .doc(recordId)
      .get();

    if (!recordDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    const recordData = recordDoc.data();
    const batchId = recordData.batchId;

    // Get the trainees document to update their attendance stats
    const traineesRef = admin.firestore().collection("trainees").doc(batchId);
    const traineesDoc = await traineesRef.get();

    if (traineesDoc.exists) {
      const traineesData = traineesDoc.data();
      const trainees = traineesData.trainees || [];

      // Create a map of student statuses from the attendance record
      const studentStatusMap = {};
      recordData.studentDetails.forEach((student) => {
        studentStatusMap[student.studentId] = student.status;
      });

      // Update trainee statistics
      const updatedTrainees = trainees.map((trainee) => {
        if (!studentStatusMap.hasOwnProperty(trainee.userId)) {
          return trainee;
        }

        // Initialize attendance stats if they don't exist
        if (!trainee.totalPresent) trainee.totalPresent = 0;
        if (!trainee.totalAbsent) trainee.totalAbsent = 0;

        // Decrement the appropriate counter based on the student's status in the deleted record
        if (studentStatusMap[trainee.userId] === "Present") {
          trainee.totalPresent = Math.max(0, trainee.totalPresent - 1);
        } else {
          trainee.totalAbsent = Math.max(0, trainee.totalAbsent - 1);
        }

        return trainee;
      });

      // Update the trainees document
      await traineesRef.update({
        trainees: updatedTrainees,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Delete the record
    await admin.firestore().collection("attendance").doc(recordId).delete();

    res.status(200).json({
      success: true,
      message: "Attendance record deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting attendance record:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete attendance record",
      error: error.message,
    });
  }
});

// Get trainees for a batch
router.get("/trainees/:batchId", authenticateUser, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Get trainees from trainees collection
    const traineesDoc = await admin
      .firestore()
      .collection("trainees")
      .doc(batchId)
      .get();

    if (!traineesDoc.exists) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const traineesData = traineesDoc.data();

    // Map trainees to the required format for attendance
    const formattedTrainees = traineesData.trainees.map((trainee) => ({
      traineeId: trainee.userId,
      name: trainee.name,
      email: trainee.email,
    }));

    res.status(200).json({
      success: true,
      data: formattedTrainees,
    });
  } catch (error) {
    console.error("Error fetching trainees:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch trainees",
      error: error.message,
    });
  }
});

export default router;
