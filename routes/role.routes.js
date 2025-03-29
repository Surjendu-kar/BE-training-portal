import express from "express";
import admin from "../config/firebase.config.js";
import authenticateUser from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get all roles
router.get("/", authenticateUser, async (req, res) => {
  try {
    // Get the roles document from Firestore
    const rolesDoc = await admin
      .firestore()
      .collection("role_permissions")
      .doc("roles")
      .get();

    if (!rolesDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Roles document not found",
      });
    }

    const rolesData = rolesDoc.data();

    res.status(200).json({
      success: true,
      roles: rolesData,
    });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch roles",
      error: error.message,
    });
  }
});

// Create a new role
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { name, active, permissions } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    // Get the current roles document
    const rolesRef = admin
      .firestore()
      .collection("role_permissions")
      .doc("roles");
    const rolesDoc = await rolesRef.get();

    if (!rolesDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Roles document not found",
      });
    }

    const rolesData = rolesDoc.data();

    // Check if role already exists
    if (rolesData[name]) {
      return res.status(400).json({
        success: false,
        message: "Role already exists",
      });
    }

    // Create the new role
    const newRole = {
      active: active !== false,
      permissions: permissions || {},
      updatedBy: req.user.email || "unknown",
      updatedAt: new Date().toISOString(),
    };

    // Update the roles document
    await rolesRef.update({
      [name]: newRole,
    });

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      role: {
        name,
        ...newRole,
      },
    });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create role",
      error: error.message,
    });
  }
});

// Update an existing role
router.put("/:roleName", authenticateUser, async (req, res) => {
  try {
    const { roleName } = req.params;
    const { name, active, permissions } = req.body;

    // Get the current roles document
    const rolesRef = admin
      .firestore()
      .collection("role_permissions")
      .doc("roles");
    const rolesDoc = await rolesRef.get();

    if (!rolesDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Roles document not found",
      });
    }

    const rolesData = rolesDoc.data();

    // Check if role exists
    if (!rolesData[roleName]) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Prevent modifying Admin role's active status
    if (roleName === "Admin" && active === false) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate Admin role",
      });
    }

    // Create updated role data
    const updatedRole = {
      ...rolesData[roleName],
      active: active !== undefined ? active : rolesData[roleName].active,
      permissions: permissions || rolesData[roleName].permissions,
      updatedBy: req.user.email || "unknown",
      updatedAt: new Date().toISOString(),
    };

    // Handle role name change
    if (name && name !== roleName) {
      // Check if new name already exists
      if (rolesData[name]) {
        return res.status(400).json({
          success: false,
          message: "A role with the new name already exists",
        });
      }

      // Create a batch to update atomically
      const batch = admin.firestore().batch();

      // Add the role with the new name
      batch.update(rolesRef, {
        [name]: updatedRole,
      });

      // Remove the old role
      batch.update(rolesRef, {
        [roleName]: admin.firestore.FieldValue.delete(),
      });

      // Commit the batch
      await batch.commit();

      res.status(200).json({
        success: true,
        message: "Role updated and renamed successfully",
        role: {
          name,
          ...updatedRole,
        },
      });
    } else {
      // Just update the existing role
      await rolesRef.update({
        [roleName]: updatedRole,
      });

      res.status(200).json({
        success: true,
        message: "Role updated successfully",
        role: {
          name: roleName,
          ...updatedRole,
        },
      });
    }
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update role",
      error: error.message,
    });
  }
});

// Delete a role
router.delete("/:roleName", authenticateUser, async (req, res) => {
  try {
    const { roleName } = req.params;

    // Prevent deleting Admin role
    if (roleName === "Admin") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete Admin role",
      });
    }

    // Get the current roles document
    const rolesRef = admin
      .firestore()
      .collection("role_permissions")
      .doc("roles");
    const rolesDoc = await rolesRef.get();

    if (!rolesDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Roles document not found",
      });
    }

    const rolesData = rolesDoc.data();

    // Check if role exists
    if (!rolesData[roleName]) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Delete the role
    await rolesRef.update({
      [roleName]: admin.firestore.FieldValue.delete(),
    });

    res.status(200).json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete role",
      error: error.message,
    });
  }
});

export default router;
