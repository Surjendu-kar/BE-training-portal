import Razorpay from "razorpay";
import crypto from "crypto";
import admin from "../config/firebase.config.js";
import { getRazorpayConfig } from "../config/razorpay.config.js";

let razorpay = null;

// Initialize Razorpay instance
async function getRazorpayInstance() {
  if (!razorpay) {
    const config = await getRazorpayConfig();
    razorpay = new Razorpay({
      key_id: config.key_id,
      key_secret: config.key_secret,
    });
  }
  return razorpay;
}

// Create a new order
export const createOrder = async (req, res) => {
  try {
    // Get the courseId, batchId, userId, name and email from the request body
    const { courseId, batchId, userId, name, email } = req.body;

    if (!courseId || !batchId) {
      return res.status(400).json({
        success: false,
        message: "Course ID and Batch ID are required",
      });
    }

    // Get course details from Firestore to get the actual price
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

    const courseData = courseDoc.data();
    const amount = courseData.course_fee || 0;

    // Convert to paise (Razorpay requires amount in smallest currency unit)
    const amountInPaise = Math.round(amount * 100);

    // Create a unique receipt ID
    const receiptId = `receipt_${Date.now()}`;

    // Get Razorpay instance and config
    const razorpayInstance = await getRazorpayInstance();
    const config = await getRazorpayConfig();

    // Create order in Razorpay
    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receiptId,
      notes: {
        courseId: courseId,
        batchId: batchId,
        userId: userId || "guest",
      },
    };

    const order = await razorpayInstance.orders.create(options);

    // Store order in Firestore for reference
    await admin
      .firestore()
      .collection("payment_orders")
      .doc(order.id)
      .set({
        orderId: order.id,
        courseId: courseId,
        batchId: batchId,
        userId: userId || "guest",
        userName: name || "",
        userEmail: email || "",
        amount: amount,
        currency: "INR",
        receipt: receiptId,
        status: order.status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        amount: amount,
        currency: "INR",
        key_id: config.key_id,
      },
    });
  } catch (error) {
    console.error("Error creating payment order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: error.message,
    });
  }
};

// Verify payment
export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    // Get Razorpay config
    const config = await getRazorpayConfig();

    // Verify the payment signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", config.key_secret)
      .update(body)
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
      // Get the order details from Firestore
      const orderDoc = await admin
        .firestore()
        .collection("payment_orders")
        .doc(razorpay_order_id)
        .get();

      if (!orderDoc.exists) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const orderData = orderDoc.data();

      // Fetch user details from user_manage collection
      let userName = orderData.userName || "";
      let userEmail = orderData.userEmail || "";
      let userData = null;

      if (orderData.userId && orderData.userId !== "guest") {
        try {
          const userDoc = await admin
            .firestore()
            .collection("user_manage")
            .doc(orderData.userId)
            .get();

          if (userDoc.exists) {
            userData = userDoc.data();
            userName = userData.fullName || "";
            userEmail = userData.email || userEmail;
          }
        } catch (error) {
          console.warn("Could not fetch user details:", error);
        }
      }

      // Create enrollment record with fresh user data
      const enrollmentData = {
        userId: orderData.userId,
        userName: userName,
        userEmail: userEmail,
        courseId: orderData.courseId,
        batchId: orderData.batchId,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: orderData.amount,
        status: "completed",
        receipt: orderData.receipt,
        enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Save enrollment to Firestore
      await admin.firestore().collection("enrollments").add(enrollmentData);

      // Add trainee to trainees collection
      const traineesRef = admin
        .firestore()
        .collection("trainees")
        .doc(orderData.batchId);
      const traineesDoc = await traineesRef.get();

      // Create a current timestamp
      const now = new Date();

      if (!traineesDoc.exists) {
        // Create new document with first trainee
        await traineesRef.set({
          trainees: [
            {
              userId: orderData.userId,
              name: userName,
              email: userEmail,
              enrolledAt: now,
              courseId: orderData.courseId,
              batchId: orderData.batchId,
            },
          ],
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(), // We can use serverTimestamp for top-level fields
        });
      } else {
        // Add trainee to existing array if not already present
        await traineesRef.update({
          trainees: admin.firestore.FieldValue.arrayUnion({
            userId: orderData.userId,
            name: userName,
            email: userEmail,
            enrolledAt: now,
            courseId: orderData.courseId,
            batchId: orderData.batchId,
          }),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Update order status and user info
      await admin
        .firestore()
        .collection("payment_orders")
        .doc(razorpay_order_id)
        .update({
          status: "paid",
          paymentId: razorpay_payment_id,
          userName: userName,
          userEmail: userEmail,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Get course details to store in user_manage collection
      const courseDoc = await admin
        .firestore()
        .collection("courses")
        .doc(orderData.courseId)
        .get();

      if (courseDoc.exists && orderData.userId) {
        const courseData = courseDoc.data();
        const courseName = courseData.title || "Unnamed Course";

        // Get the user reference
        const userRef = admin
          .firestore()
          .collection("user_manage")
          .doc(orderData.userId);

        // Create a courses field if it doesn't exist
        // Store the course with default values for attendance, progress, etc.
        const userUpdateData = {
          [`courses.${orderData.courseId}`]: {
            name: courseName,
            enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
            batchId: orderData.batchId,
            attendanceRate: 0,
            progress: 0,
            averageScore: 0,
            lastAccessed: admin.firestore.FieldValue.serverTimestamp(),
            status: "ongoing",
            instructor: courseData.instructor || "",
            duration: courseData.duration || "",
          },
        };

        // Update user with enrolled course information
        await userRef.update(userUpdateData);

        // Also update the enrolledCourseIds array for backward compatibility
        await userRef.update({
          enrolledCourseIds: admin.firestore.FieldValue.arrayUnion(
            orderData.courseId
          ),
        });
      }

      res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        data: {
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
        },
      });
    } else {
      // Payment verification failed
      res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message,
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;

    const orderDoc = await admin
      .firestore()
      .collection("payment_orders")
      .doc(orderId)
      .get();

    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const orderData = orderDoc.data();

    res.status(200).json({
      success: true,
      data: {
        orderId: orderData.orderId,
        status: orderData.status,
        paymentId: orderData.paymentId || null,
      },
    });
  } catch (error) {
    console.error("Error getting payment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment status",
      error: error.message,
    });
  }
};

// Get all course fees
export const getAllFees = async (req, res) => {
  try {
    // Optional query parameters for filtering
    const { status, limit = 50 } = req.query;

    // Start building the query
    let query = admin.firestore().collection("courses");

    // Apply filters if provided
    if (status) {
      query = query.where("courseStatus", "==", status);
    }

    // Execute the query
    const snapshot = await query.limit(parseInt(limit)).get();

    // Process the results
    const fees = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      fees.push({
        courseId: doc.id,
        title: data.title || "Untitled Course",
        fee: data.course_fee || 0,
        status: data.courseStatus || "Unknown",
        instructor: data.instructor || "Unknown",
        createdAt: data.createdAt ? data.createdAt.toDate() : null,
      });
    });

    // Return the results
    res.status(200).json({
      success: true,
      count: fees.length,
      data: fees,
    });
  } catch (error) {
    console.error("Error fetching course fees:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch course fees",
      error: error.message,
    });
  }
};

// Get all payment records with details
export const getAllPayments = async (req, res) => {
  try {
    // Optional query parameters for filtering
    const { status, limit = 50 } = req.query;

    // Start with enrollments collection (for completed payments)
    let query = admin.firestore().collection("enrollments");

    // Apply filters if provided
    if (status === "completed") {
      query = query.where("status", "==", "completed");
    }

    // Execute the query
    const snapshot = await query.limit(parseInt(limit)).get();

    // Process the results
    const payments = [];

    // Create an array of promises for the user, course, and batch lookups
    const promises = snapshot.docs.map(async (doc) => {
      const data = doc.data();

      // Get course details
      const courseDoc = await admin
        .firestore()
        .collection("courses")
        .doc(data.courseId)
        .get();
      const courseData = courseDoc.exists ? courseDoc.data() : {};

      // Get payment order details - ONLY if orderId exists
      let orderData = {};
      if (data.orderId) {
        const orderDoc = await admin
          .firestore()
          .collection("payment_orders")
          .doc(data.orderId)
          .get();
        orderData = orderDoc.exists ? orderDoc.data() : {};
      }

      // If enrollment doesn't have receipt but order does, update the enrollment
      if (
        !data.receipt &&
        orderData.receipt &&
        req.query.updateReceipts === "true"
      ) {
        try {
          await admin
            .firestore()
            .collection("enrollments")
            .doc(doc.id)
            .update({ receipt: orderData.receipt });

          // Update local data object
          data.receipt = orderData.receipt;
        } catch (updateError) {
          console.warn(
            `Failed to update receipt for enrollment ${doc.id}:`,
            updateError
          );
        }
      }

      // Handle transaction IDs based on payment status
      let transactionId = data.paymentId || "Unknown";
      let paymentDate = orderData.updatedAt
        ? formatDate(orderData.updatedAt.toDate().toISOString().split("T")[0])
        : data.paymentDate
        ? formatDate(data.paymentDate)
        : data.enrolledAt
        ? formatDate(
            new Date(data.enrolledAt.seconds * 1000).toISOString().split("T")[0]
          )
        : null;

      if (data.status === "partial" && data.installmentDetails) {
        // For partial payments, show both transaction IDs if available
        const installment1Id =
          data.installmentDetails.installment1?.transactionId || "";
        const installment2Id =
          data.installmentDetails.installment2?.transactionId || "";

        if (installment1Id && installment2Id) {
          transactionId = `${installment1Id}, ${installment2Id}`;
        } else if (installment1Id) {
          transactionId = installment1Id;
        }

        // Handle payment dates for installments
        const installment1Date = data.installmentDetails.installment1?.date
          ? formatDate(data.installmentDetails.installment1.date)
          : "";
        const installment2Date = data.installmentDetails.installment2?.date
          ? formatDate(data.installmentDetails.installment2.date)
          : "";

        if (installment1Date && installment2Date) {
          paymentDate = `${installment1Date}, ${installment2Date}`;
        } else if (installment1Date) {
          paymentDate = installment1Date;
        }
      }

      payments.push({
        id: doc.id,
        traineeName: data.userName || "Unknown",
        email: data.userEmail || "No Email",
        courseName: courseData.title || "Unknown Course",
        batchId: data.batchId || "Unknown",
        amount: data.amount || 0,
        paymentStatus: data.status || "Unknown",
        transactionId: transactionId,
        receiptId: data.receipt || orderData.receipt || "",
        paymentDate: paymentDate,
        paymentMode: data.paymentMode || "Online",
        dueDate: "",
        installments: data.installments || "No",
        installmentDetails: data.installmentDetails || null,
      });
    });

    // Wait for all promises to resolve
    await Promise.all(promises);

    // Return the results
    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
};

// Helper function to format date to DD-MM-YYYY
const formatDate = (dateString) => {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  return `${day}-${month}-${year}`;
};

// Generate and download payment receipt
export const downloadReceipt = async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Get payment details from Firestore
    const paymentDoc = await admin
      .firestore()
      .collection("enrollments")
      .doc(paymentId)
      .get();

    if (!paymentDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    const paymentData = paymentDoc.data();

    // Get payment order details to fetch receipt info (only if orderId exists)
    let orderData = {};
    if (paymentData.orderId && !paymentData.orderId.startsWith("MANUAL-")) {
      const orderDoc = await admin
        .firestore()
        .collection("payment_orders")
        .doc(paymentData.orderId)
        .get();

      orderData = orderDoc.exists ? orderDoc.data() : {};
    }

    // Get course details
    const courseDoc = await admin
      .firestore()
      .collection("courses")
      .doc(paymentData.courseId)
      .get();
    const courseData = courseDoc.exists ? courseDoc.data() : {};

    // Generate PDF receipt
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ margin: 50 });

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt-${paymentId}.pdf`
    );

    // Pipe the PDF directly to the response
    doc.pipe(res);

    // Generate a consistent receipt number format for both Razorpay and manual payments
    let receiptNumber;
    if (orderData.receipt) {
      // For Razorpay payments, use the existing receipt number
      receiptNumber = orderData.receipt;
      // Make sure it starts with receipt_ prefix
      if (!receiptNumber.startsWith("receipt_")) {
        receiptNumber = `receipt_${receiptNumber}`;
      }
    } else {
      // For manual payments, use transaction ID with the same format as Razorpay
      receiptNumber = `receipt_${
        paymentData.paymentId || Date.now().toString()
      }`;
    }

    // Use payment date from the payment data if it exists, otherwise current date
    const receiptDate =
      paymentData.paymentDate || new Date().toISOString().split("T")[0];

    // Add logo or header
    doc.fontSize(20).text("PAYMENT RECEIPT", { align: "center" });
    doc.moveDown();

    // Add a horizontal line
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Receipt details
    doc.fontSize(12);
    doc.text(`Receipt Number: ${receiptNumber}`, { align: "right" });
    doc.text(`Date: ${receiptDate}`, { align: "right" });
    doc.moveDown();

    // Customer information
    doc.fontSize(14).text("Customer Information", { underline: true });
    doc.fontSize(12);
    doc.text(`Name: ${paymentData.userName || "N/A"}`);
    doc.text(`Email: ${paymentData.userEmail || "N/A"}`);
    doc.moveDown();

    // Standardize payment status for display
    let displayStatus = paymentData.status || "N/A";
    if (displayStatus.toLowerCase() === "paid") {
      displayStatus = "completed";
    }

    // Payment details
    doc.fontSize(14).text("Payment Details", { underline: true });
    doc.fontSize(12);
    doc.text(
      `Course: ${courseData?.title || courseData?.courseName || "Course"}`
    );
    doc.text(`Amount: Rs. ${paymentData.amount}`);
    doc.text(`Payment ID: ${paymentData.paymentId || "N/A"}`);
    doc.text(`Payment Status: ${displayStatus}`);
    doc.text(`Payment Mode: ${paymentData.paymentMode || "Online"}`);
    doc.moveDown(2);

    // Add a thank you note
    doc.fontSize(10).text("Thank you for your payment!", { align: "center" });
    doc.text(
      "This is a computer-generated receipt and does not require a signature.",
      { align: "center" }
    );

    // Finalize the PDF
    doc.end();
  } catch (error) {
    console.error("Error generating receipt:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate receipt",
      error: error.message,
    });
  }
};

// Handle manual payment entry
export const addManualPayment = async (req, res) => {
  try {
    const {
      userId,
      userName,
      userEmail,
      courseId,
      batchId,
      amount,
      status,
      paymentId,
      paymentDate,
      paymentMode,
      installments,
      installmentDetails,
      ...otherFields
    } = req.body;

    // Create enrollment record with basic fields
    const enrollmentData = {
      userId,
      userName,
      userEmail,
      courseId,
      batchId,
      amount,
      status,
      paymentMode,
      installments,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Handle installment details in a cleaner way
    if (installmentDetails) {
      enrollmentData.installmentDetails = {
        installment1: {
          amount: installmentDetails.installment1.amount,
          date: installmentDetails.installment1.date,
          transactionId: installmentDetails.installment1.transactionId,
        },
      };

      if (installmentDetails.installment2?.amount > 0) {
        enrollmentData.installmentDetails.installment2 = {
          amount: installmentDetails.installment2.amount,
          date: installmentDetails.installment2.date,
          transactionId: installmentDetails.installment2.transactionId,
        };
      }

      // Set payment date and transaction ID based on installments
      const dates = [];
      const transactionIds = [];

      dates.push(installmentDetails.installment1.date);
      transactionIds.push(installmentDetails.installment1.transactionId);

      if (installmentDetails.installment2?.amount > 0) {
        dates.push(installmentDetails.installment2.date);
        transactionIds.push(installmentDetails.installment2.transactionId);
      }

      enrollmentData.paymentDate = dates.join(", ");
      enrollmentData.paymentId = transactionIds.join(", ");
    } else {
      // For non-installment payments
      enrollmentData.paymentDate = paymentDate;
      enrollmentData.paymentId = paymentId;
    }

    // Add orderId for manual payments
    enrollmentData.orderId = `MANUAL-${Date.now()}`;

    // Add to enrollments collection
    const enrollmentRef = await admin
      .firestore()
      .collection("enrollments")
      .add(enrollmentData);

    // Add trainee to trainees collection
    const traineesRef = admin.firestore().collection("trainees").doc(batchId);
    const traineesDoc = await traineesRef.get();

    const now = new Date();

    if (!traineesDoc.exists) {
      await traineesRef.set({
        trainees: [
          {
            userId,
            name: userName,
            email: userEmail,
            enrolledAt: now,
            courseId,
            batchId,
          },
        ],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await traineesRef.update({
        trainees: admin.firestore.FieldValue.arrayUnion({
          userId,
          name: userName,
          email: userEmail,
          enrolledAt: now,
          courseId,
          batchId,
        }),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Also update the user_manage collection with course information
    if (userId) {
      // Get course details to store in user_manage collection
      const courseDoc = await admin
        .firestore()
        .collection("courses")
        .doc(courseId)
        .get();

      if (courseDoc.exists) {
        const courseData = courseDoc.data();
        const courseName = courseData.title || "Unnamed Course";

        // Get the user reference
        const userRef = admin.firestore().collection("user_manage").doc(userId);

        // Create a courses field if it doesn't exist
        // Store the course with default values for attendance, progress, etc.
        const userUpdateData = {
          [`courses.${courseId}`]: {
            name: courseName,
            enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
            batchId: batchId,
            attendanceRate: 0,
            progress: 0,
            averageScore: 0,
            lastAccessed: admin.firestore.FieldValue.serverTimestamp(),
            status: "ongoing",
            instructor: courseData.instructor || "",
            duration: courseData.duration || "",
          },
        };

        // Update user with enrolled course information
        await userRef.update(userUpdateData);

        // Also update the enrolledCourseIds array for backward compatibility
        await userRef.update({
          enrolledCourseIds: admin.firestore.FieldValue.arrayUnion(courseId),
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Payment added successfully",
      data: {
        enrollmentId: enrollmentRef.id,
      },
    });
  } catch (error) {
    console.error("Error adding manual payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add payment",
      error: error.message,
    });
  }
};

// Update payment details
export const updatePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const {
      amount,
      paymentStatus,
      transactionId,
      paymentDate,
      paymentMode,
      installments,
      installmentDetails,
      ...otherFields
    } = req.body;

    // Get payment document
    const paymentRef = admin
      .firestore()
      .collection("enrollments")
      .doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Prepare update data
    const updateData = {
      amount: parseFloat(amount),
      status: paymentStatus.toLowerCase(),
      paymentMode,
      installments,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Handle installment details
    if (installmentDetails) {
      updateData.installmentDetails = {
        installment1: {
          amount: installmentDetails.installment1.amount,
          date: installmentDetails.installment1.date,
          transactionId: installmentDetails.installment1.transactionId,
        },
      };

      if (installmentDetails.installment2?.amount > 0) {
        updateData.installmentDetails.installment2 = {
          amount: installmentDetails.installment2.amount,
          date: installmentDetails.installment2.date,
          transactionId: installmentDetails.installment2.transactionId,
        };
      }

      // Set payment date and transaction ID based on installments
      const dates = [];
      const transactionIds = [];

      dates.push(installmentDetails.installment1.date);
      transactionIds.push(installmentDetails.installment1.transactionId);

      if (installmentDetails.installment2?.amount > 0) {
        dates.push(installmentDetails.installment2.date);
        transactionIds.push(installmentDetails.installment2.transactionId);
      }

      updateData.paymentDate = dates.join(", ");
      updateData.paymentId = transactionIds.join(", ");
    } else {
      // For non-installment payments
      updateData.paymentDate = paymentDate;
      updateData.paymentId = transactionId;
    }

    // Update the payment record
    await paymentRef.update(updateData);

    res.status(200).json({
      success: true,
      message: "Payment updated successfully",
      data: {
        id: paymentId,
        ...updateData,
      },
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment",
      error: error.message,
    });
  }
};

// Get payment details by ID
export const getPaymentDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Get payment document
    const paymentRef = admin
      .firestore()
      .collection("enrollments")
      .doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Return the payment data
    const paymentData = paymentDoc.data();

    res.status(200).json({
      success: true,
      data: paymentData,
    });
  } catch (error) {
    console.error("Error getting payment details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
      error: error.message,
    });
  }
};

// Update attendance rate for a course
export const updateAttendanceRate = async (req, res) => {
  try {
    const { userId, courseId } = req.params;
    const { attendanceRate } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Course ID are required",
      });
    }

    if (
      attendanceRate === undefined ||
      attendanceRate < 0 ||
      attendanceRate > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid attendance rate (0-100) is required",
      });
    }

    // Get the user document
    const userDoc = await admin
      .firestore()
      .collection("user_manage")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userData = userDoc.data();

    // Check if the user is enrolled in this course
    if (!userData.courses || !userData.courses[courseId]) {
      return res.status(404).json({
        success: false,
        message: "Course not found in user's enrolled courses",
      });
    }

    // Update the attendance rate for the specific course
    await admin
      .firestore()
      .collection("user_manage")
      .doc(userId)
      .update({
        [`courses.${courseId}.attendanceRate`]: attendanceRate,
        [`courses.${courseId}.lastUpdated`]:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    res.status(200).json({
      success: true,
      message: "Attendance rate updated successfully",
      data: {
        userId,
        courseId,
        attendanceRate,
      },
    });
  } catch (error) {
    console.error("Error updating attendance rate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update attendance rate",
      error: error.message,
    });
  }
};

// Update course progress percentage
export const updateCourseProgress = async (req, res) => {
  try {
    const { userId, courseId } = req.params;
    const { progress } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Course ID are required",
      });
    }

    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        message: "Valid progress percentage (0-100) is required",
      });
    }

    // Get the user document
    const userDoc = await admin
      .firestore()
      .collection("user_manage")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userData = userDoc.data();

    // Check if the user is enrolled in this course
    if (!userData.courses || !userData.courses[courseId]) {
      return res.status(404).json({
        success: false,
        message: "Course not found in user's enrolled courses",
      });
    }

    // Update fields to modify
    const updateFields = {
      [`courses.${courseId}.progress`]: progress,
      [`courses.${courseId}.lastAccessed`]:
        admin.firestore.FieldValue.serverTimestamp(),
      [`courses.${courseId}.lastUpdated`]:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    // If progress is 100%, update status to completed
    if (progress === 100) {
      updateFields[`courses.${courseId}.status`] = "completed";
    }

    // Update the progress percentage and last accessed timestamp
    await admin
      .firestore()
      .collection("user_manage")
      .doc(userId)
      .update(updateFields);

    res.status(200).json({
      success: true,
      message: "Course progress updated successfully",
      data: {
        userId,
        courseId,
        progress,
        status: progress === 100 ? "completed" : "ongoing",
      },
    });
  } catch (error) {
    console.error("Error updating course progress:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course progress",
      error: error.message,
    });
  }
};

// Add or update course details for existing trainees
export const updateTraineeCourseDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      courseId,
      courseName,
      batchId,
      attendanceRate,
      progress,
      averageScore,
      enrolledAt,
      instructor,
      duration,
      status,
    } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Course ID are required",
      });
    }

    if (!courseName) {
      return res.status(400).json({
        success: false,
        message: "Course name is required",
      });
    }

    // Get the user document
    const userRef = admin.firestore().collection("user_manage").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Create default values for optional fields
    const now = admin.firestore.FieldValue.serverTimestamp();
    const courseDetails = {
      name: courseName,
      batchId: batchId || "",
      attendanceRate: attendanceRate !== undefined ? attendanceRate : 0,
      progress: progress !== undefined ? progress : 0,
      averageScore: averageScore !== undefined ? averageScore : 0,
      status: status || (progress === 100 ? "completed" : "ongoing"),
      enrolledAt: enrolledAt || now,
      lastAccessed: now,
      lastUpdated: now,
      instructor: instructor || "",
      duration: duration || "",
    };

    // Update the user document with course details
    await userRef.update({
      [`courses.${courseId}`]: courseDetails,
      enrolledCourseIds: admin.firestore.FieldValue.arrayUnion(courseId),
    });

    res.status(200).json({
      success: true,
      message: "Course details updated successfully",
      data: {
        userId,
        courseId,
        courseDetails,
      },
    });
  } catch (error) {
    console.error("Error updating trainee course details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update trainee course details",
      error: error.message,
    });
  }
};

// Batch update course details for multiple trainees
export const batchUpdateTraineeCourses = async (req, res) => {
  try {
    const { trainees } = req.body;

    if (!trainees || !Array.isArray(trainees) || trainees.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Valid trainees array is required",
      });
    }

    const batch = admin.firestore().batch();
    const now = admin.firestore.Timestamp.now();
    const results = { success: [], failed: [] };

    // Process each trainee
    for (const trainee of trainees) {
      const {
        userId,
        courseId,
        courseName,
        batchId,
        attendanceRate,
        progress,
        averageScore,
        instructor,
        duration,
        status,
      } = trainee;

      if (!userId || !courseId || !courseName) {
        results.failed.push({
          userId,
          courseId,
          reason: "Missing required fields",
        });
        continue;
      }

      try {
        const userRef = admin.firestore().collection("user_manage").doc(userId);

        // Create course details object
        const courseDetails = {
          name: courseName,
          batchId: batchId || "",
          attendanceRate: attendanceRate !== undefined ? attendanceRate : 0,
          progress: progress !== undefined ? progress : 0,
          averageScore: averageScore !== undefined ? averageScore : 0,
          status: status || (progress === 100 ? "completed" : "ongoing"),
          enrolledAt: now,
          lastAccessed: now,
          lastUpdated: now,
          instructor: instructor || "",
          duration: duration || "",
        };

        // Add to batch for course details update
        batch.update(userRef, {
          [`courses.${courseId}`]: courseDetails,
        });

        // Add to batch for enrolledCourseIds update (as a separate operation to avoid conflicts)
        batch.update(userRef, {
          enrolledCourseIds: admin.firestore.FieldValue.arrayUnion(courseId),
        });

        results.success.push({ userId, courseId });
      } catch (error) {
        console.error(`Error processing trainee ${userId}:`, error);
        results.failed.push({ userId, courseId, reason: error.message });
      }
    }

    // Commit the batch
    await batch.commit();

    res.status(200).json({
      success: true,
      message: `Processed ${results.success.length} trainees successfully. Failed: ${results.failed.length}`,
      data: results,
    });
  } catch (error) {
    console.error("Error in batch update of trainee courses:", error);
    res.status(500).json({
      success: false,
      message: "Failed to batch update trainee courses",
      error: error.message,
    });
  }
};

// Get all courses for a trainee
export const getTraineeCourses = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get the user document
    const userDoc = await admin
      .firestore()
      .collection("user_manage")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userData = userDoc.data();
    const courses = userData.courses || {};

    // Format the response
    const formattedCourses = Object.entries(courses).map(
      ([courseId, courseData]) => ({
        courseId,
        ...courseData,
        // Convert timestamps to readable format if they exist
        enrolledAt: courseData.enrolledAt
          ? courseData.enrolledAt.toDate
            ? courseData.enrolledAt.toDate()
            : courseData.enrolledAt
          : null,
        lastAccessed: courseData.lastAccessed
          ? courseData.lastAccessed.toDate
            ? courseData.lastAccessed.toDate()
            : courseData.lastAccessed
          : null,
        lastUpdated: courseData.lastUpdated
          ? courseData.lastUpdated.toDate
            ? courseData.lastUpdated.toDate()
            : courseData.lastUpdated
          : null,
      })
    );

    res.status(200).json({
      success: true,
      count: formattedCourses.length,
      data: formattedCourses,
    });
  } catch (error) {
    console.error("Error getting trainee courses:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get trainee courses",
      error: error.message,
    });
  }
};
