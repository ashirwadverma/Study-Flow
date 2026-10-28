const express = require("express");
const {
  signup,
  verifyEmail,
  resendVerification,
  login,
  logout,
  getMe,
} = require("../controllers/authController");
const { authLimiter, resendLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.post("/signup", authLimiter, signup);
router.get("/verify-email", verifyEmail);
router.post("/resend-verification", resendLimiter, resendVerification);
router.post("/login", authLimiter, login);
router.post("/logout", logout);
router.get("/me", getMe);

module.exports = router;
