const express = require("express");
const { getUserStudyData, saveUserStudyData } = require("../controllers/studyDataController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/data", requireAuth, getUserStudyData);
router.post("/data", requireAuth, saveUserStudyData);

module.exports = router;
