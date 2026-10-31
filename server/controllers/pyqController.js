/**
 * pyqController.js
 * 
 * Handles previous-year paper uploads, multi-paper extraction, 
 * topic prioritization, question reclassifications, and study plan generation.
 */

const fs = require("fs");
const path = require("path");
const db = require("../services/dbAdapter");
const { extractQuestionsFromPaper } = require("../services/pyqExtractor");
const { calculateTopicPriorities } = require("../services/pyqPrioritization");

/**
 * POST /api/pyq/upload-analyze (Protected)
 * Uploads one or more question papers and generates evidence-based topic prioritization.
 */
async function uploadAndAnalyzePYQ(req, res) {
  const uploadedFiles = req.files || [];
  const tempFilePaths = uploadedFiles.map(f => f.path);

  try {
    const userId = req.user._id || req.user.id;
    const {
      subjectId,
      subjectName,
      courseCode,
      university,
      semester,
      examType,
      examDate,
      weakTopics
    } = req.body || {};

    if (!subjectName || !subjectName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Subject name is required for analysis."
      });
    }

    if (!uploadedFiles.length && !req.body.pastedPaperText) {
      return res.status(400).json({
        success: false,
        message: "Please upload at least one question paper PDF or paste exam questions."
      });
    }

    const cleanSubjectId = (subjectId && subjectId.trim()) ? subjectId.trim() : `sub_${Date.now()}`;
    const cleanSubjectName = subjectName.trim();

    // Parse years array
    let yearsArray = [];
    if (req.body.years) {
      try {
        yearsArray = typeof req.body.years === "string" ? JSON.parse(req.body.years) : req.body.years;
      } catch (e) {
        yearsArray = [req.body.years];
      }
    }

    // Parse syllabus units if passed or load from existing user study data
    let syllabusUnits = [];
    if (req.body.syllabusUnits) {
      try {
        syllabusUnits = typeof req.body.syllabusUnits === "string" ? JSON.parse(req.body.syllabusUnits) : req.body.syllabusUnits;
      } catch (e) {
        syllabusUnits = [];
      }
    }

    if (!syllabusUnits.length) {
      const userStudyData = await db.getUserStudyData(userId);
      const matchedSub = (userStudyData.subjects || []).find(
        s => s.id === cleanSubjectId || (s.name && s.name.toLowerCase().trim() === cleanSubjectName.toLowerCase().trim())
      );
      if (matchedSub && Array.isArray(matchedSub.units) && matchedSub.units.length > 0) {
        syllabusUnits = matchedSub.units;
      }
    }

    const isSyllabusConfirmed = req.body.syllabusConfirmed === "true" || req.body.syllabusConfirmed === true;
    if ((!syllabusUnits || !Array.isArray(syllabusUnits) || syllabusUnits.length === 0) && isSyllabusConfirmed) {
      syllabusUnits = [
        { unitNumber: 1, title: "Unit 1: Fundamentals & Core Concepts", topics: [`Foundations of ${cleanSubjectName}`, "Core Principles & Definitions", "Basic Theoretical Models"] },
        { unitNumber: 2, title: "Unit 2: Analytical Methods & Formulations", topics: ["Mathematical & Analytical Formulations", "Key Theorems & Methods", "Standard Equations"] },
        { unitNumber: 3, title: "Unit 3: Applied Techniques & Algorithms", topics: ["Algorithm Design & Problem Solving", "Analysis Methods", "System Techniques"] },
        { unitNumber: 4, title: "Unit 4: Advanced Systems & Architecture", topics: ["Advanced Concepts", "System Architecture", "Performance Optimization"] },
        { unitNumber: 5, title: "Unit 5: Applications, Design & Emerging Trends", topics: ["Practical Applications", "Case Studies & Synthesis", "Modern Implementations"] }
      ];
    }

    // Mandatory Syllabus Enforcement: PYQ Analyzer requires syllabus to match questions against official curriculum topics
    if (!syllabusUnits || !Array.isArray(syllabusUnits) || syllabusUnits.length === 0) {
      return res.status(400).json({
        success: false,
        requiresSyllabus: true,
        message: `Syllabus is required before analyzing previous-year question papers for "${cleanSubjectName}". Please upload the official syllabus or tick the syllabus confirmation box.`,
      });
    }

    // Parse weak topics
    let weakTopicsList = [];
    if (weakTopics) {
      try {
        weakTopicsList = typeof weakTopics === "string" ? JSON.parse(weakTopics) : weakTopics;
      } catch (e) {
        weakTopicsList = [weakTopics];
      }
    }

    const papersMetadata = [];
    const allQuestions = [];

    // Process uploaded files
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      const paperYear = (yearsArray[i] && String(yearsArray[i]).trim()) ? String(yearsArray[i]).trim() : (req.body.defaultYear || "2024");
      const paperId = `paper_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`;
      const fileBuffer = fs.readFileSync(file.path);

      console.log(`Processing PYQ paper ${i + 1}/${uploadedFiles.length}: ${file.originalname} (Year: ${paperYear})`);

      const extractionResult = await extractQuestionsFromPaper({
        filePath: file.path,
        fileBuffer,
        mimeType: file.mimetype,
        filename: file.originalname,
        year: paperYear,
        subjectName: cleanSubjectName,
        syllabusUnits
      });

      const paperQuestions = (extractionResult.questions || []).map(q => ({
        ...q,
        paperId,
        paperYear,
        paperName: file.originalname
      }));

      papersMetadata.push({
        id: paperId,
        fileName: file.originalname,
        year: paperYear,
        fileSize: file.size,
        pageCount: 1,
        isScannedPdf: extractionResult.isScannedPdf || false,
        extractedQuestionsCount: paperQuestions.length,
        uploadedAt: new Date()
      });

      allQuestions.push(...paperQuestions);
    }

    // Handle manual pasted text fallback if no files
    if (!uploadedFiles.length && req.body.pastedPaperText) {
      const paperYear = req.body.defaultYear || "2024";
      const paperId = `paper_paste_${Date.now()}`;
      const extractionResult = await extractQuestionsFromPaper({
        fileBuffer: Buffer.from(req.body.pastedPaperText, "utf-8"),
        mimeType: "text/plain",
        filename: "Pasted Question Paper",
        year: paperYear,
        subjectName: cleanSubjectName,
        syllabusUnits
      });

      const paperQuestions = (extractionResult.questions || []).map(q => ({
        ...q,
        paperId,
        paperYear,
        paperName: "Pasted Exam Questions"
      }));

      papersMetadata.push({
        id: paperId,
        fileName: "Pasted Exam Paper",
        year: paperYear,
        fileSize: req.body.pastedPaperText.length,
        pageCount: 1,
        isScannedPdf: false,
        extractedQuestionsCount: paperQuestions.length,
        uploadedAt: new Date()
      });

      allQuestions.push(...paperQuestions);
    }

    const replaceExisting = req.body.replaceExisting === "true" || req.body.replaceExisting === true;

    // Accumulate multi-year evidence: merge new papers & questions with existing records for this subject
    let finalPapers = [];
    let finalQuestions = [];

    if (!replaceExisting) {
      const existingAnalysis = await db.getPYQAnalysis(userId, cleanSubjectId);
      if (existingAnalysis && Array.isArray(existingAnalysis.papers) && existingAnalysis.papers.length > 0) {
        const existingPapers = [...existingAnalysis.papers];
        const existingQuestions = [...(existingAnalysis.questions || [])];

        // If newly uploaded paper has identical year and filename, replace that paper; otherwise accumulate
        const newYears = papersMetadata.map(p => String(p.year));
        const newFileNames = papersMetadata.map(p => (p.fileName || "").toLowerCase());

        const keptPapers = existingPapers.filter(ep => {
          const isReplaced = newYears.includes(String(ep.year)) && newFileNames.includes((ep.fileName || "").toLowerCase());
          return !isReplaced;
        });

        const keptPaperIds = new Set(keptPapers.map(p => p.id));
        const keptQuestions = existingQuestions.filter(eq => eq.paperId && keptPaperIds.has(eq.paperId));

        finalPapers = [...keptPapers, ...papersMetadata];
        finalQuestions = [...keptQuestions, ...allQuestions];
      } else {
        finalPapers = papersMetadata;
        finalQuestions = allQuestions;
      }
    } else {
      finalPapers = papersMetadata;
      finalQuestions = allQuestions;
    }

    // Calculate transparent scoring and priorities across ALL accumulated years
    const prioritizationResult = calculateTopicPriorities(
      finalQuestions,
      finalPapers,
      syllabusUnits,
      weakTopicsList
    );

    const accumulatedYears = [...new Set(finalPapers.map(p => p.year))].filter(Boolean).sort();

    const pyqRecord = {
      userId,
      subjectId: cleanSubjectId,
      subjectName: cleanSubjectName,
      courseCode: courseCode || "",
      university: university || "",
      semester: semester || "",
      examType: examType || "Semester Exam",
      examDate: examDate || null,
      papers: finalPapers,
      questions: finalQuestions,
      topicPriorities: prioritizationResult.topicPriorities,
      syllabusCoverage: prioritizationResult.syllabusCoverage,
      algorithmWeights: prioritizationResult.algorithmWeights,
      summaryNote: prioritizationResult.summaryNote
    };

    // Save into database / memory store
    const savedRecord = await db.savePYQAnalysis(userId, cleanSubjectId, pyqRecord);

    const isAccumulated = finalPapers.length > papersMetadata.length;
    const successMsg = isAccumulated
      ? `Added ${papersMetadata.length} paper(s). Now accumulated ${finalPapers.length} question papers (${accumulatedYears.join(", ")}) for ${cleanSubjectName}! Topic priorities recalculated across all years.`
      : `Successfully analyzed ${finalPapers.length} question paper${finalPapers.length > 1 ? "s" : ""} and extracted ${finalQuestions.length} questions.`;

    return res.status(200).json({
      success: true,
      message: successMsg,
      data: savedRecord
    });
  } catch (error) {
    console.error("uploadAndAnalyzePYQ error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process question papers."
    });
  } finally {
    // Clean up temporary uploaded files
    tempFilePaths.forEach(fp => {
      if (fp && fs.existsSync(fp)) {
        try {
          fs.unlinkSync(fp);
        } catch (e) {
          console.warn("Temp file cleanup warning:", e.message);
        }
      }
    });
  }
}

/**
 * GET /api/pyq/subject/:subjectId (Protected)
 * Retrieves saved PYQ analysis for a specific subject.
 */
async function getSubjectPYQAnalysis(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { subjectId } = req.params;

    const analysis = await db.getPYQAnalysis(userId, subjectId);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: "No question paper analysis found for this subject."
      });
    }

    return res.status(200).json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error("getSubjectPYQAnalysis error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve question paper analysis."
    });
  }
}

/**
 * GET /api/pyq/history (Protected)
 * Retrieves all analyzed subjects for the authenticated user.
 */
async function getUserPYQHistory(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const history = await db.getUserPYQHistory(userId);

    return res.status(200).json({
      success: true,
      data: history || []
    });
  } catch (error) {
    console.error("getUserPYQHistory error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve PYQ history."
    });
  }
}

/**
 * PUT /api/pyq/question/:subjectId/:questionId (Protected)
 * Allows student to edit/reclassify an extracted question's topic, unit, or marks.
 * Automatically recalculates ranking based on student review.
 */
async function reclassifyQuestion(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { subjectId, questionId } = req.params;
    const { matchedTopic, detectedUnit, marks, userNotes } = req.body || {};

    const analysis = await db.getPYQAnalysis(userId, subjectId);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: "Analysis not found."
      });
    }

    const questionIndex = (analysis.questions || []).findIndex(q => q.id === questionId);
    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Question not found in paper analysis."
      });
    }

    // Update question
    if (matchedTopic && matchedTopic.trim()) {
      analysis.questions[questionIndex].matchedTopic = matchedTopic.trim();
    }
    if (detectedUnit) {
      analysis.questions[questionIndex].detectedUnit = detectedUnit.trim();
    }
    if (marks !== undefined) {
      analysis.questions[questionIndex].marks = marks !== null ? parseInt(marks, 10) : null;
    }
    if (userNotes !== undefined) {
      analysis.questions[questionIndex].userNotes = userNotes;
    }
    analysis.questions[questionIndex].isUserCorrected = true;

    // Recalculate topic priorities and syllabus coverage
    const userStudyData = await db.getUserStudyData(userId);
    const matchedSub = (userStudyData.subjects || []).find(s => s.id === subjectId || (s.name && s.name.toLowerCase() === analysis.subjectName.toLowerCase()));
    const syllabusUnits = (matchedSub && matchedSub.units) ? matchedSub.units : [];

    const updatedPriorities = calculateTopicPriorities(
      analysis.questions,
      analysis.papers,
      syllabusUnits,
      [],
      analysis.algorithmWeights || {}
    );

    analysis.topicPriorities = updatedPriorities.topicPriorities;
    analysis.syllabusCoverage = updatedPriorities.syllabusCoverage;
    analysis.summaryNote = updatedPriorities.summaryNote;

    const saved = await db.savePYQAnalysis(userId, subjectId, analysis);

    return res.status(200).json({
      success: true,
      message: "Question reclassified and topic priorities recalculated successfully.",
      data: saved
    });
  } catch (error) {
    console.error("reclassifyQuestion error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update question classification."
    });
  }
}

/**
 * DELETE /api/pyq/subject/:subjectId (Protected)
 * Deletes question paper analysis for a subject.
 */
async function deleteSubjectPYQ(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { subjectId } = req.params;

    await db.deletePYQAnalysis(userId, subjectId);

    return res.status(200).json({
      success: true,
      message: "Previous year paper analysis deleted."
    });
  } catch (error) {
    console.error("deleteSubjectPYQ error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete analysis."
    });
  }
}

/**
 * POST /api/pyq/generate-plan (Protected)
 * Connects PYQ analysis directly to StudyFlow's study planner.
 * Uses historical question frequency as a high-yield scheduling weight.
 */
async function generateStudyPlanFromPYQ(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const {
      subjectId,
      examDate,
      dailyStudyHours = 3.0,
      customPriorities,
      overrideExistingSessions = true
    } = req.body || {};

    const analysis = await db.getPYQAnalysis(userId, subjectId);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: "No PYQ analysis found for this subject."
      });
    }

    const userStudyData = await db.getUserStudyData(userId);
    let subjects = userStudyData.subjects || [];
    let sessions = userStudyData.sessions || [];
    let activity = userStudyData.activity || [];

    // Ensure subject exists in user's subjects
    let targetSubject = subjects.find(s => s.id === subjectId || (s.name && s.name.toLowerCase() === analysis.subjectName.toLowerCase()));
    if (!targetSubject) {
      targetSubject = {
        id: subjectId || `sub_${Date.now()}`,
        name: analysis.subjectName,
        courseCode: analysis.courseCode || null,
        instructor: analysis.university || null,
        examDate: examDate || analysis.examDate || null,
        color: "#4f46e5",
        units: []
      };
      subjects.push(targetSubject);
    } else if (examDate) {
      targetSubject.examDate = examDate;
    }

    // Determine target exam date
    const finalExamDate = examDate || targetSubject.examDate || analysis.examDate;
    let daysAvailable = 30;
    if (finalExamDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const exDate = new Date(finalExamDate + "T00:00:00");
      const diffDays = Math.ceil((exDate - today) / (1000 * 60 * 60 * 24));
      daysAvailable = Math.max(3, diffDays);
    }

    // Get prioritized topics list (either custom overrides or analysis priorities)
    const topicList = Array.isArray(customPriorities) && customPriorities.length > 0
      ? customPriorities
      : analysis.topicPriorities;

    // Filter or prepare sessions
    if (overrideExistingSessions) {
      sessions = sessions.filter(s => s.subjectId !== targetSubject.id);
    }

    const scheduledSessions = [];
    const unscheduledTopics = [];

    // Calculate total available study capacity in hours
    const totalCapacityHours = daysAvailable * parseFloat(dailyStudyHours);
    let allocatedHours = 0;

    // Sort topics by priority (High priority first, then Medium, then Low)
    const sortedTopics = [...topicList].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    sortedTopics.forEach((t, index) => {
      const isHigh = t.priorityLevel === "High" || (t.priorityScore >= 65);
      const isMedium = t.priorityLevel === "Medium" || (t.priorityScore >= 40 && t.priorityScore < 65);

      const hours = isHigh ? 3.0 : (isMedium ? 2.5 : 2.0);
      const difficulty = isHigh ? "hard" : (isMedium ? "medium" : "easy");

      // Check capacity
      if (allocatedHours + hours <= totalCapacityHours + 4) { // small grace margin
        // Calculate spread date: schedule sequentially from tomorrow across available days
        const totalTopics = Math.max(1, sortedTopics.length);
        let dayOffset;
        if (daysAvailable >= totalTopics) {
          dayOffset = Math.round((index / Math.max(1, totalTopics - 1)) * (daysAvailable - 2)) + 1;
        } else {
          dayOffset = Math.min(daysAvailable - 1, Math.floor((index / totalTopics) * daysAvailable) + 1);
        }

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + dayOffset);
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, "0");
        const d = String(targetDate.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;

        const sessionObj = {
          id: `ses_pyq_${Date.now()}_${index}`,
          subjectId: targetSubject.id,
          topic: `${t.unit && t.unit !== "General" ? `${t.unit}: ` : ""}${t.topicName}`,
          hours,
          difficulty,
          date: dateStr,
          status: "pending",
          priorityLevel: t.priorityLevel || "Medium",
          pyqScore: t.priorityScore || 50,
          isPyqPrioritized: true
        };

        scheduledSessions.push(sessionObj);
        sessions.push(sessionObj);
        allocatedHours += hours;
      } else {
        unscheduledTopics.push({
          topicName: t.topicName,
          priorityLevel: t.priorityLevel,
          priorityScore: t.priorityScore,
          requiredHours: hours,
          reason: `Insufficient study days (${daysAvailable} days left with ${dailyStudyHours}h/day). Priority topics scheduled first.`
        });
      }
    });

    activity.unshift({
      msg: `Created evidence-based study plan for <strong>${targetSubject.name}</strong> (${scheduledSessions.length} sessions from PYQ analysis) 🎯`,
      time: Date.now()
    });

    if (activity.length > 30) activity.pop();

    await db.saveUserStudyData(userId, {
      subjects,
      sessions,
      activity
    });

    return res.status(200).json({
      success: true,
      message: `Study plan generated with ${scheduledSessions.length} prioritized sessions.`,
      data: {
        subject: targetSubject,
        scheduledSessions,
        unscheduledTopics,
        totalCapacityHours,
        allocatedHours,
        daysAvailable,
        examDate: finalExamDate
      }
    });
  } catch (error) {
    console.error("generateStudyPlanFromPYQ error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not generate study plan from analysis."
    });
  }
}

/**
 * DELETE /api/pyq/paper/:subjectId/:paperId (Protected)
 * Removes an individual question paper and recalculates topic priorities for the remaining years.
 */
async function deleteSinglePaper(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { subjectId, paperId } = req.params;

    const analysis = await db.getPYQAnalysis(userId, subjectId);
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: "Analysis not found for this subject."
      });
    }

    const remainingPapers = (analysis.papers || []).filter(p => p.id !== paperId);
    const remainingQuestions = (analysis.questions || []).filter(q => q.paperId !== paperId);

    if (remainingPapers.length === 0) {
      await db.deletePYQAnalysis(userId, subjectId);
      return res.status(200).json({
        success: true,
        message: "All question papers removed. Analysis reset.",
        data: null
      });
    }

    // Get syllabus units
    const userStudyData = await db.getUserStudyData(userId);
    const matchedSub = (userStudyData.subjects || []).find(s => s.id === subjectId || (s.name && s.name.toLowerCase().trim() === (analysis.subjectName || "").toLowerCase().trim()));
    const syllabusUnits = (matchedSub && matchedSub.units) ? matchedSub.units : [];

    const prioritizationResult = calculateTopicPriorities(
      remainingQuestions,
      remainingPapers,
      syllabusUnits
    );

    const updatedAnalysis = {
      ...analysis,
      papers: remainingPapers,
      questions: remainingQuestions,
      topicPriorities: prioritizationResult.topicPriorities,
      syllabusCoverage: prioritizationResult.syllabusCoverage,
      algorithmWeights: prioritizationResult.algorithmWeights,
      summaryNote: prioritizationResult.summaryNote
    };

    const saved = await db.savePYQAnalysis(userId, subjectId, updatedAnalysis);
    return res.status(200).json({
      success: true,
      message: `Paper removed. Topic priorities recalculated across remaining ${remainingPapers.length} paper(s).`,
      data: saved
    });
  } catch (error) {
    console.error("deleteSinglePaper error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove question paper."
    });
  }
}

module.exports = {
  uploadAndAnalyzePYQ,
  getSubjectPYQAnalysis,
  getUserPYQHistory,
  reclassifyQuestion,
  deleteSubjectPYQ,
  deleteSinglePaper,
  generateStudyPlanFromPYQ
};
