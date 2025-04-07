import express from "express";
import {
  createOrder,
  verifyPayment,
  getPaymentStatus,
  getAllFees,
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

export default router;
