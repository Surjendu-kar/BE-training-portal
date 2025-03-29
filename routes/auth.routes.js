import express from "express";
import admin from "../config/firebase.config.js";
import authenticateUser from "../middlewares/auth.middleware.js";
import axios from "axios";

const router = express.Router();

// Email/password login endpoint
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Use Firebase REST API with your web API key
    try {
      const response = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
        {
          email,
          password,
          returnSecureToken: true,
        }
      );

      // Return the Firebase ID token
      res.status(200).json({
        success: true,
        message: "Login successful",
        idToken: response.data.idToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
        userId: response.data.localId,
      });
    } catch (error) {
      console.error(
        "Firebase authentication error:",
        error.response?.data || error.message
      );
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
        error: error.response?.data?.error?.message || error.message,
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
      error: error.message,
    });
  }
});

// User registration endpoint
router.post("/register", authenticateUser, async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    // Validate input
    if (!fullName || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: fullName,
    });

    // Set custom claims for role
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: role,
    });

    // Store additional user data in Firestore
    await admin.firestore().collection("user_manage").doc(userRecord.uid).set({
      uid: userRecord.uid,
      fullName: fullName,
      email: email,
      role: role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        uid: userRecord.uid,
        fullName: fullName,
        email: email,
        role: role,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create user",
      error: error.message,
    });
  }
});

// Endpoint to verify a Firebase token
router.post("/verify-token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "No token provided",
      });
    }

    // Verify the token
    const decodedToken = await admin.auth().verifyIdToken(token);

    res.status(200).json({
      success: true,
      message: "Token verified successfully",
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        displayName: decodedToken.name,
        photoURL: decodedToken.picture,
      },
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid token",
      error: error.message,
    });
  }
});

// Protected endpoint to test authentication middleware
router.get("/profile", authenticateUser, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Authentication successful",
    user: req.user,
  });
});

export default router;
