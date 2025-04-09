import admin from "./firebase.config.js";

let cachedConfig = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export async function getAppConfig() {
  const currentTime = Date.now();

  // Return cached config if it's still valid
  if (cachedConfig && currentTime - lastFetchTime < CACHE_DURATION) {
    return cachedConfig;
  }

  try {
    const configDoc = await admin
      .firestore()
      .collection("app_config")
      .doc("razorpay")
      .get();

    if (!configDoc.exists) {
      throw new Error("Razorpay configuration not found in Firebase");
    }

    cachedConfig = configDoc.data();
    lastFetchTime = currentTime;

    return cachedConfig;
  } catch (error) {
    console.error("Error fetching app configuration:", error);
    throw error;
  }
}
