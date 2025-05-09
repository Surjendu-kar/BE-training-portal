import express from "express";
import {
  createOrder,
  verifyPayment,
  getPaymentStatus,
  getAllFees,
  getAllPayments,
  downloadReceipt,
  addManualPayment,
  updatePayment,
  getPaymentDetails,
  updateAttendanceRate,
  updateCourseProgress,
  updateTraineeCourseDetails,
  batchUpdateTraineeCourses,
  getTraineeCourses,
} from "../controllers/payment.controller.js";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Create a new payment order
router.post("/create-order", authenticateUser, createOrder);

// Verify payment
router.post("/verify-payment", verifyPayment);

// Get payment status
router.get("/status/:orderId", authenticateUser, getPaymentStatus);

// Get all course fees
router.get("/fees", authenticateUser, getAllFees);

// Get all payments with details
router.get("/all-payments", authenticateUser, getAllPayments);

// Download payment receipt
router.get("/receipt/:paymentId", authenticateUser, downloadReceipt);

// Add manual payment
router.post("/manual-payment", authenticateUser, addManualPayment);

// Update payment
router.put("/:paymentId", authenticateUser, updatePayment);

// Get payment details by ID
router.get("/:paymentId", authenticateUser, getPaymentDetails);

// Update attendance rate for a user's course
router.put(
  "/attendance-rate/:userId/:courseId",
  authenticateUser,
  updateAttendanceRate
);

// Update course progress percentage
router.put(
  "/course-progress/:userId/:courseId",
  authenticateUser,
  updateCourseProgress
);

// Add or update course details for a trainee
router.put(
  "/trainee-course/:userId",
  authenticateUser,
  updateTraineeCourseDetails
);

// Batch update multiple trainees' course details
router.post(
  "/batch-update-courses",
  authenticateUser,
  batchUpdateTraineeCourses
);

// Get all courses for a trainee
router.get("/trainee-courses/:userId", authenticateUser, getTraineeCourses);

export default router;
