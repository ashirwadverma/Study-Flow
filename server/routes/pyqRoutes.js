const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  uploadAndAnalyzePYQ,
  getSubjectPYQAnalysis,
  getUserPYQHistory,
  reclassifyQuestion,
  deleteSubjectPYQ,
  deleteSinglePaper,
  generateStudyPlanFromPYQ
} = require("../controllers/pyqController");

const router = express.Router();

// Multer upload config for multiple previous year paper PDFs
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB per file
    files: 10 // Max 10 papers per batch
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp"
    ];

    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and Image files are allowed."));
    }
  }
});

// All PYQ routes are strictly protected with authentication and user data isolation
router.post("/upload-analyze", requireAuth, upload.array("papers", 10), uploadAndAnalyzePYQ);
router.get("/subject/:subjectId", requireAuth, getSubjectPYQAnalysis);
router.get("/history", requireAuth, getUserPYQHistory);
router.put("/question/:subjectId/:questionId", requireAuth, reclassifyQuestion);
router.delete("/paper/:subjectId/:paperId", requireAuth, deleteSinglePaper);
router.delete("/subject/:subjectId", requireAuth, deleteSubjectPYQ);
router.post("/generate-plan", requireAuth, generateStudyPlanFromPYQ);

module.exports = router;
