// Razorpay configuration
import { getAppConfig } from "./app.config.js";

let razorpayConfig = null;

export async function getRazorpayConfig() {
  if (!razorpayConfig) {
    const config = await getAppConfig();
    razorpayConfig = {
      key_id: config.RAZORPAY_KEY_ID,
      key_secret: config.RAZORPAY_KEY_SECRET,
    };
  }
  return razorpayConfig;
}

export default getRazorpayConfig;
