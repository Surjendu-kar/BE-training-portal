// Razorpay configuration
import dotenv from "dotenv";
dotenv.config();

const razorpayConfig = {
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
};

export default razorpayConfig;
