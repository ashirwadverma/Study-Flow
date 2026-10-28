const express = require("express");
const multer = require("multer");

const { analyzeSyllabus } = require("../controllers/syllabusController");

const router = express.Router();

// Store uploaded files temporarily in /uploads
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and Image (PNG, JPG, WEBP) files are allowed."));
    }
  },
});

// POST /api/syllabus/analyze
router.post("/analyze", upload.single("syllabus"), analyzeSyllabus);

module.exports = router;
