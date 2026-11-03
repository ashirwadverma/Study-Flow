const path = require("path");
const express = require("express");
const multer = require("multer");

const { analyzeSyllabus } = require("../controllers/syllabusController");

const router = express.Router();

// Store uploaded files temporarily in uploads/
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/x-pdf",
      "application/acrobat",
      "applications/vnd.pdf",
      "text/pdf",
      "text/x-pdf",
      "text/plain",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    const ext = path.extname(file.originalname || "").toLowerCase();
    const isAllowedExt = [".pdf", ".txt", ".png", ".jpg", ".jpeg", ".webp"].includes(ext);

    if (
      isAllowedExt ||
      allowedTypes.includes(file.mimetype) ||
      (file.mimetype && file.mimetype.startsWith("image/"))
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and Image (PNG, JPG, WEBP) syllabus documents are supported."));
    }
  },
});

// Middleware wrapper that guarantees clean JSON on any multer upload error
function handleUpload(req, res, next) {
  upload.single("syllabus")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File exceeds 20MB limit. Please upload a smaller syllabus file.",
          });
        }
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to process uploaded file.",
      });
    }
    next();
  });
}

// POST endpoints for syllabus analysis
router.post("/analyze", handleUpload, analyzeSyllabus);
router.post("/upload", handleUpload, analyzeSyllabus);
router.post("/parse", handleUpload, analyzeSyllabus);
router.post("/", handleUpload, analyzeSyllabus);

module.exports = router;
