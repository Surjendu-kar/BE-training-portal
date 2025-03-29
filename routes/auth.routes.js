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

// Update user endpoint
router.put("/users/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, role, password } = req.body;

    // Validate input
    if (!fullName || !email || !role) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Update user in Firestore
    await admin.firestore().collection("user_manage").doc(userId).update({
      fullName,
      email,
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If password is provided, update it in Firebase Auth
    if (password) {
      await admin.auth().updateUser(userId, {
        password: password,
      });
    }

    // Update email and displayName in Firebase Auth
    await admin.auth().updateUser(userId, {
      email: email,
      displayName: fullName,
    });

    // Update custom claims for role
    await admin.auth().setCustomUserClaims(userId, {
      role: role,
    });

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: {
        uid: userId,
        fullName,
        email,
        role,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message,
    });
  }
});

// Delete user endpoint
router.delete("/users/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;

    // Delete user from Firebase Auth
    await admin.auth().deleteUser(userId);

    // Delete user from Firestore
    await admin.firestore().collection("user_manage").doc(userId).delete();

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
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

// Get all users endpoint
router.get("/users", authenticateUser, async (req, res) => {
  try {
    // Get all users from Firestore
    const usersSnapshot = await admin
      .firestore()
      .collection("user_manage")
      .get();

    if (usersSnapshot.empty) {
      return res.status(200).json({
        success: true,
        users: [],
      });
    }

    const users = [];
    usersSnapshot.forEach((doc) => {
      users.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    res.status(200).json({
      success: true,
      users: users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
});

export default router;
