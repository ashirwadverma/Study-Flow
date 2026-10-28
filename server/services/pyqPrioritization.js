/**
 * pyqPrioritization.js
 * 
 * Evidence-based topic prioritization and syllabus coverage algorithm.
 * Implements transparent mathematical scoring with documented weights.
 */

const DEFAULT_WEIGHTS = {
  paperFrequencyWeight: 0.35,  // How many distinct papers contain the topic
  recurrenceWeight: 0.25,      // Consistency across historical years
  marksWeight: 0.20,           // Marks associated with the topic
  questionVolumeWeight: 0.10,  // Total question occurrences (log-scaled)
  syllabusBonus: 0.05,         // Alignment with official syllabus units
  weaknessBonus: 0.05          // Student's weak/difficult topic boost
};

/**
 * Calculates evidence-based topic priorities from extracted questions and syllabus metadata.
 * 
 * @param {Array} questions - Extracted question objects from all uploaded papers
 * @param {Array} papers - Metadata of uploaded question papers (with years)
 * @param {Array} syllabusUnits - Enrolled syllabus units and topics (if available)
 * @param {Array} weakTopicsList - Topics marked difficult/weak by student
 * @param {Object} customWeights - Optional overrides for algorithm weights
 * @returns {Object} { topicPriorities, syllabusCoverage, summaryNote }
 */
function calculateTopicPriorities(questions = [], papers = [], syllabusUnits = [], weakTopicsList = [], customWeights = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...customWeights };
  const totalPapers = Math.max(1, papers.length);
  const isSinglePaper = totalPapers === 1;

  // Extract all unique years available across uploaded papers
  const allPaperYears = [...new Set(papers.map(p => String(p.year || "Unknown")).filter(y => y !== "Unknown"))];
  const totalUniqueYears = Math.max(1, allPaperYears.length);

  // Build a map of all syllabus topics for alignment and gap detection
  const syllabusTopicMap = new Map(); // normalized name -> { unitNumber, unitTitle, originalTitle, difficulty }
  if (Array.isArray(syllabusUnits)) {
    syllabusUnits.forEach((unit, uIdx) => {
      const uNum = unit.unitNumber || (uIdx + 1);
      const uTitle = unit.title || `Unit ${uNum}`;
      (unit.topics || []).forEach(t => {
        const titleStr = typeof t === "string" ? t : (t.title || t.name || "");
        if (titleStr) {
          const normKey = normalizeTopicName(titleStr);
          syllabusTopicMap.set(normKey, {
            unit: `Unit ${uNum}: ${uTitle}`,
            unitNumber: uNum,
            unitTitle: uTitle,
            originalTitle: titleStr,
            difficulty: (typeof t === "object" && t.difficulty) ? t.difficulty : "medium",
            isWeak: weakTopicsList.some(w => normalizeTopicName(w).includes(normKey) || normKey.includes(normalizeTopicName(w)))
          });
        }
      });
    });
  }

  // Group questions by matched topic
  const topicStats = new Map();

  questions.forEach(q => {
    const topicName = (q.matchedTopic || "General Concepts").trim();
    const normKey = normalizeTopicName(topicName);

    if (!topicStats.has(normKey)) {
      // Check if topic matches syllabus
      let matchedSyllabusEntry = null;
      for (const [sKey, sVal] of syllabusTopicMap.entries()) {
        if (normKey.includes(sKey) || sKey.includes(normKey)) {
          matchedSyllabusEntry = sVal;
          break;
        }
      }

      topicStats.set(normKey, {
        displayName: matchedSyllabusEntry ? matchedSyllabusEntry.originalTitle : topicName,
        unit: q.detectedUnit || (matchedSyllabusEntry ? matchedSyllabusEntry.unit : "General"),
        questions: [],
        paperIds: new Set(),
        years: new Set(),
        totalMarks: 0,
        knownMarksQuestionsCount: 0,
        hasLongAnswer: false,
        isExplicitSyllabusTopic: !!matchedSyllabusEntry,
        isWeakTopic: matchedSyllabusEntry ? matchedSyllabusEntry.isWeak : weakTopicsList.some(w => normalizeTopicName(w).includes(normKey))
      });
    }

    const stat = topicStats.get(normKey);
    stat.questions.push(q);
    if (q.paperId) stat.paperIds.add(q.paperId);
    if (q.paperYear && q.paperYear !== "Unknown") stat.years.add(String(q.paperYear));
    if (typeof q.marks === "number" && !isNaN(q.marks) && q.marks > 0) {
      stat.totalMarks += q.marks;
      stat.knownMarksQuestionsCount++;
      if (q.marks >= 7) stat.hasLongAnswer = true;
    }
  });

  // Calculate maximums for normalization
  let maxQuestionsCount = 1;
  let maxMarks = 1;
  for (const stat of topicStats.values()) {
    if (stat.questions.length > maxQuestionsCount) maxQuestionsCount = stat.questions.length;
    if (stat.totalMarks > maxMarks) maxMarks = stat.totalMarks;
  }

  const topicPriorities = [];

  for (const [normKey, stat] of topicStats.entries()) {
    const paperCount = stat.paperIds.size;
    const questionCount = stat.questions.length;
    const yearsList = [...stat.years].sort();
    const yearsCount = stat.years.size;

    // 1. Paper Frequency Factor (0.0 to 1.0)
    const paperFreqScore = paperCount / totalPapers;

    // 2. Recurrence Factor (0.0 to 1.0)
    // If only 1 paper uploaded, we cannot reliably establish multi-year recurrence
    let recurrenceScore = 0.5;
    if (!isSinglePaper && totalUniqueYears > 1) {
      recurrenceScore = yearsCount / totalUniqueYears;
    } else if (!isSinglePaper && totalUniqueYears === 1) {
      recurrenceScore = paperFreqScore;
    }

    // 3. Marks Factor (0.0 to 1.0) - only evaluates known marks
    let marksScore = 0.3; // baseline if marks are unknown
    if (maxMarks > 0 && stat.totalMarks > 0) {
      marksScore = stat.totalMarks / maxMarks;
    }

    // 4. Question Volume Factor (0.0 to 1.0) with logarithmic dampening to prevent single paper blowout
    const volumeScore = Math.log2(1 + questionCount) / Math.max(1, Math.log2(1 + maxQuestionsCount));

    // 5. Syllabus Bonus (1.0 or 0.0)
    const sylBonus = stat.isExplicitSyllabusTopic ? 1.0 : 0.4;

    // 6. Weakness Bonus (1.0 or 0.0)
    const weakBonus = stat.isWeakTopic ? 1.0 : 0.0;

    // Composite Weighted Calculation
    const rawScore = (
      paperFreqScore * weights.paperFrequencyWeight +
      recurrenceScore * weights.recurrenceWeight +
      marksScore * weights.marksWeight +
      volumeScore * weights.questionVolumeWeight +
      sylBonus * weights.syllabusBonus +
      weakBonus * weights.weaknessBonus
    ) * 100;

    const priorityScore = Math.min(100, Math.max(5, Math.round(rawScore)));

    // Categorization
    let priorityLevel = "Low";
    if (priorityScore >= 65) {
      priorityLevel = "High";
    } else if (priorityScore >= 40) {
      priorityLevel = "Medium";
    }

    // Generate evidence-based explanation
    const avgMarks = stat.knownMarksQuestionsCount > 0 ? (stat.totalMarks / stat.knownMarksQuestionsCount).toFixed(1) : null;
    let explanation = "";

    if (isSinglePaper) {
      explanation = `Appeared ${questionCount} time${questionCount > 1 ? "s" : ""} in uploaded ${yearsList[0] || "paper"}${stat.totalMarks > 0 ? ` (${stat.totalMarks} marks total)` : ""}. Note: Recurrence across years cannot be established from a single paper.`;
    } else {
      const yearSpanStr = yearsList.length > 0 ? `across ${yearsList.join(", ")}` : "in past papers";
      const marksText = stat.totalMarks > 0 ? ` with ${stat.totalMarks} total marks` : "";
      const longAnsText = stat.hasLongAnswer ? " including high-weight long answer questions" : "";
      
      explanation = `Appeared in ${paperCount} of ${totalPapers} papers (${Math.round(paperFreqScore * 100)}%) ${yearSpanStr}${marksText}${longAnsText}. ${priorityLevel} historical exam frequency.`;
    }

    if (stat.isWeakTopic) {
      explanation += " Boosted due to self-identified weak/challenging topic status.";
    }

    topicPriorities.push({
      topicName: stat.displayName,
      unit: stat.unit,
      priorityScore,
      priorityLevel,
      paperCount,
      totalPaperCount: totalPapers,
      paperFrequencyPercent: Math.round(paperFreqScore * 100),
      questionCount,
      yearsAppeared: yearsList,
      totalMarks: stat.totalMarks,
      averageMarksPerQuestion: avgMarks ? parseFloat(avgMarks) : null,
      hasLongAnswer: stat.hasLongAnswer,
      isExplicitSyllabusTopic: stat.isExplicitSyllabusTopic,
      isWeakTopic: stat.isWeakTopic,
      explanation
    });
  }

  // Sort by priorityScore descending
  topicPriorities.sort((a, b) => b.priorityScore - a.priorityScore);

  // ─── SYLLABUS COVERAGE ANALYSIS ─────────────────────────────
  const totalSyllabusTopicsCount = syllabusTopicMap.size;
  const coveredTopics = [];
  const uncoveredTopics = [];

  if (totalSyllabusTopicsCount > 0) {
    for (const [sKey, sVal] of syllabusTopicMap.entries()) {
      let matchedPriority = null;
      for (const tp of topicPriorities) {
        const normTp = normalizeTopicName(tp.topicName);
        if (normTp.includes(sKey) || sKey.includes(normTp)) {
          matchedPriority = tp;
          break;
        }
      }

      if (matchedPriority) {
        coveredTopics.push({
          unit: sVal.unit,
          topicName: sVal.originalTitle,
          appearances: matchedPriority.questionCount,
          paperCount: matchedPriority.paperCount
        });
      } else {
        uncoveredTopics.push({
          unit: sVal.unit,
          topicName: sVal.originalTitle,
          difficulty: sVal.difficulty,
          reason: `No questions found in the ${totalPapers} uploaded paper${totalPapers > 1 ? "s" : ""}. Still required for full syllabus mastery.`
        });
      }
    }
  }

  const coveragePercentage = totalSyllabusTopicsCount > 0 
    ? Math.round((coveredTopics.length / totalSyllabusTopicsCount) * 100)
    : (topicPriorities.length > 0 ? 100 : 0);

  const syllabusCoverage = {
    totalSyllabusTopics: totalSyllabusTopicsCount,
    coveredTopicsCount: coveredTopics.length,
    uncoveredTopicsCount: uncoveredTopics.length,
    coveragePercentage,
    uncoveredTopics,
    coveredTopics
  };

  let summaryNote = "";
  if (isSinglePaper) {
    summaryNote = `Analysis generated from 1 uploaded question paper (${papers[0]?.year || "Current"}). Historical recurrence cannot be established until papers from multiple exam cycles are uploaded.`;
  } else {
    summaryNote = `Analyzed ${totalPapers} previous-year papers spanning ${allPaperYears.sort().join(" to ")}. Identified ${topicPriorities.filter(t => t.priorityLevel === "High").length} high-yield topics and ${uncoveredTopics.length} unexamined syllabus topics.`;
  }

  return {
    topicPriorities,
    syllabusCoverage,
    algorithmWeights: weights,
    summaryNote
  };
}

/**
 * Normalizes topic names for fuzzy matching and deduplication.
 */
function normalizeTopicName(str = "") {
  return String(str || "")
    .toLowerCase()
    .replace(/^unit\s*\d+[:\-–\s]*/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  calculateTopicPriorities,
  DEFAULT_WEIGHTS,
  normalizeTopicName
};
