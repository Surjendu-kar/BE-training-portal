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

export default router;
