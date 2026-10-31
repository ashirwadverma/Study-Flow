/**
 * pyqExtractor.js
 * 
 * Extracts individual questions, marks, and topic classifications from 
 * previous-year question papers (PDF/Text/Scanned) using Gemini AI + Heuristic parser.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { GoogleGenAI } = require("@google/genai");
const { extractTextFromPDF } = require("./pdfExtractor");
const fs = require("fs");

/**
 * Heuristic parser fallback for university question papers (AKTU, VTU, Mumbai, Delhi, GTU, CBSE, etc.)
 */
function heuristicQuestionParser(text = "", year = "Unknown", filename = "", syllabusUnits = []) {
  console.log("Using heuristic question paper parser fallback...");
  const rawLines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // Administrative / Header noise detector
  const isNoise = (line) => {
    return (
      /^(roll\s*no|b\.?tech|b\.?e\.?|semester|examination|total\s*marks|time\s*:\s*\d|note\s*:|attempt\s*all|instructions?|paper\s*id|subject\s*code|page\s*\d|section\s*[-–—]?[a-c]?$)/i.test(line) ||
      /^(signature|invigilator|marks\s*allotted|maximum\s*marks|duration)/i.test(line)
    );
  };

  const questions = [];
  let currentQuestion = null;
  let qCounter = 1;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isNoise(line)) continue;

    // Detect question number pattern e.g. "1.", "Q1.", "Q.1(a)", "1 (a)", "(a)", "2.", "Question 3:"
    const qMatch = line.match(/^(?:(?:Q(?:uestion)?\.?\s*)?(\d+[\.\)]?\s*(?:\([a-eA-E\d]+\))?|\([a-eA-E\d]+\)))\s*[:\-–]?\s*(.*)/i);
    
    // Detect marks pattern e.g. "(10 Marks)", "[5 Marks]", "(7)", "[10]", "10M", "CO1, L3 (10)"
    const marksMatch = line.match(/(?:\[|\()(\d{1,2})\s*(?:marks?|pts?|m)?(?:\)|\])|(?:^|\s)(\d{1,2})\s*marks?\b/i);
    let extractedMarks = null;
    if (marksMatch) {
      extractedMarks = parseInt(marksMatch[1] || marksMatch[2], 10);
    }

    if (qMatch && (qMatch[2] || rawLines[i + 1])) {
      if (currentQuestion && currentQuestion.questionText.length > 10) {
        questions.push(finalizeQuestion(currentQuestion, syllabusUnits, year));
      }

      const qNum = qMatch[1].replace(/[:\-–]/g, "").trim() || `Q${qCounter++}`;
      let qText = qMatch[2] || "";
      // Clean marks from text
      qText = qText.replace(/(?:\[|\()(\d{1,2})\s*(?:marks?|pts?|m)?(?:\)|\])/i, "").trim();

      currentQuestion = {
        questionNumber: qNum,
        questionText: qText,
        marks: extractedMarks,
        paperYear: year
      };
    } else if (currentQuestion) {
      // Append multi-line question text
      if (!isNoise(line)) {
        if (!currentQuestion.marks && extractedMarks) {
          currentQuestion.marks = extractedMarks;
        }
        const cleanedLine = line.replace(/(?:\[|\()(\d{1,2})\s*(?:marks?|pts?|m)?(?:\)|\])/i, "").trim();
        if (cleanedLine) {
          currentQuestion.questionText += " " + cleanedLine;
        }
      }
    }
  }

  if (currentQuestion && currentQuestion.questionText.length > 10) {
    questions.push(finalizeQuestion(currentQuestion, syllabusUnits, year));
  }

  // If no questions could be parsed heuristically, produce default sample questions from text blocks
  if (!questions.length && rawLines.length > 0) {
    const meaningfulLines = rawLines.filter(l => !isNoise(l) && l.length > 20);
    meaningfulLines.slice(0, 10).forEach((ml, idx) => {
      questions.push(finalizeQuestion({
        questionNumber: `Q${idx + 1}`,
        questionText: ml,
        marks: idx % 2 === 0 ? 10 : 5,
        paperYear: year
      }, syllabusUnits, year));
    });
  }

  return questions;
}

function finalizeQuestion(qObj, syllabusUnits = [], year = "Unknown") {
  const text = qObj.questionText.trim();
  let matchedTopic = "Core Principles & Architecture";
  let detectedUnit = "Unit 1";
  let isExplicitSyllabusMatch = false;

  // Attempt to match against known syllabus units
  if (syllabusUnits && syllabusUnits.length) {
    for (const unit of syllabusUnits) {
      const uNum = unit.unitNumber || 1;
      const uTitle = unit.title || `Unit ${uNum}`;
      for (const t of (unit.topics || [])) {
        const tTitle = typeof t === "string" ? t : (t.title || "");
        const words = tTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const matchCount = words.filter(w => text.toLowerCase().includes(w)).length;
        if (matchCount >= 2 || (words.length === 1 && text.toLowerCase().includes(words[0]))) {
          matchedTopic = tTitle;
          detectedUnit = `Unit ${uNum}: ${uTitle}`;
          isExplicitSyllabusMatch = true;
          break;
        }
      }
      if (isExplicitSyllabusMatch) break;
    }
  }

  // Fallback concept detection from key terms
  if (!isExplicitSyllabusMatch) {
    const topicKeywords = [
      { term: /booth|multipli/i, topic: "Booth's Multiplication & Arithmetic Logic", unit: "Unit 2: Computer Arithmetic" },
      { term: /addressing mode/i, topic: "Addressing Modes & Instruction Formats", unit: "Unit 1: Machine Instructions" },
      { term: /pipeline|hazard/i, topic: "Pipelining & Instruction Hazards", unit: "Unit 3: Processing Unit" },
      { term: /cache|mapping|hit ratio/i, topic: "Cache Memory Organization & Mapping", unit: "Unit 4: Memory Architecture" },
      { term: /virtual memory|page fault|tlb|paging/i, topic: "Virtual Memory Management & Paging", unit: "Unit 4: Memory Architecture" },
      { term: /interrupt|dma|programmed i\/o/i, topic: "I/O Interface & DMA Controllers", unit: "Unit 5: I/O Organization" },
      { term: /binary search tree|avl|tree traversal/i, topic: "Trees & Balanced Search Trees", unit: "Unit 3: Non-Linear Data Structures" },
      { term: /graph|dijkstra|bfs|dfs/i, topic: "Graph Algorithms & Shortest Paths", unit: "Unit 4: Graph Systems" },
      { term: /stack|queue|infix|postfix/i, topic: "Stacks, Queues & Expression Parsing", unit: "Unit 2: Linear Data Structures" },
      { term: /deadlock|banker|semaphore/i, topic: "Deadlocks & Process Synchronization", unit: "Unit 2: Concurrency & Synchronization" },
      { term: /normalization|bcnf|3nf|sql/i, topic: "Database Normalization & Relational Design", unit: "Unit 3: Relational Architecture" }
    ];

    for (const tk of topicKeywords) {
      if (tk.term.test(text)) {
        matchedTopic = tk.topic;
        detectedUnit = tk.unit;
        break;
      }
    }
  }

  return {
    id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    questionNumber: qObj.questionNumber || "Q1",
    questionText: text,
    marks: typeof qObj.marks === "number" ? qObj.marks : null,
    detectedUnit,
    matchedTopic,
    secondaryTopics: [],
    isExplicitSyllabusMatch,
    isAiInferred: !isExplicitSyllabusMatch,
    confidence: isExplicitSyllabusMatch ? "high" : "medium",
    paperYear: year,
    isUserCorrected: false
  };
}

/**
 * Extracts questions from a question paper using Gemini AI (with heuristic fallback).
 */
async function extractQuestionsFromPaper({ filePath, fileBuffer, mimeType, filename, year, subjectName = "Course", syllabusUnits = [] }) {
  let extractedText = "";
  let isScannedPdf = false;

  // 1. First attempt text layer extraction from PDF
  if (filePath && mimeType === "application/pdf") {
    try {
      const parsedText = await extractTextFromPDF(filePath);
      if (parsedText && parsedText.trim().length >= 40) {
        extractedText = parsedText;
      } else {
        isScannedPdf = true;
      }
    } catch (err) {
      console.warn("PDF text parse warning:", err.message);
      isScannedPdf = true;
    }
  } else if (fileBuffer && mimeType === "text/plain") {
    extractedText = fileBuffer.toString("utf-8");
  }

  // 2. Prepare detailed syllabus context for AI topic matching
  let syllabusContext = "";
  if (syllabusUnits && syllabusUnits.length) {
    const formattedUnits = syllabusUnits.map((u, i) => {
      const uNum = u.unitNumber || i + 1;
      const uTitle = u.title || `Unit ${uNum}`;
      const topicsList = (u.topics || []).map(t => typeof t === "string" ? t : (t.title || t.name || "")).filter(Boolean);
      return `• Unit ${uNum}: ${uTitle}\n  Topics: ${topicsList.length > 0 ? topicsList.join(", ") : "All core topics for this unit"}`;
    }).join("\n\n");

    syllabusContext = `
================================================================================
OFFICIAL MANDATORY COURSE SYLLABUS FOR: "${subjectName}"
================================================================================
${formattedUnits}
================================================================================
MANDATORY SYLLABUS MATCHING INSTRUCTIONS:
1. You MUST classify and map EVERY extracted question directly against the topics and units defined in the above official course syllabus.
2. "matchedTopic": MUST be the official topic title from the syllabus that best covers the question (e.g. if the question is about "Euler's method", match it to the syllabus topic "Numerical Methods & Euler's Formula").
3. "detectedUnit": MUST be the exact Unit name from the syllabus above (e.g. "Unit 1: Linear Algebra", "Unit 2: Differential Equations").
4. "isExplicitSyllabusMatch": Set to true when the question corresponds to an official topic in the syllabus.
`;
  }

  const prompt = `
You are an expert university exam analyzer and subject matter expert for "${subjectName}".

TASK:
Extract all individual questions from the uploaded university examination question paper (Year: ${year || "Unknown"}, File: ${filename || "Paper"}).

CRITICAL EXTRACTION RULES:
1. Extract EVERY distinct question, sub-question, or problem (e.g. Q1(a), Q1(b), Q2, Q3.a, etc.).
2. Clean out all repeated university boilerplate headers, instructions ("Attempt any five", "Time: 3 Hours", "Max Marks: 100", roll number boxes).
3. Do NOT invent questions. Preserve original question meaning.
4. Extract marks for each question as an integer if clearly specified in the paper (e.g. 5, 7, 10, 15). If marks are NOT specified, return null.
5. Identify the precise academic topic tested by each question based on the official syllabus.
${syllabusContext}
6. Set confidence to "high", "medium", or "low".
7. Return ONLY valid, schema-conforming JSON with NO markdown backticks or explanation.

REQUIRED JSON OUTPUT FORMAT:
{
  "paperYear": "${year || "Unknown"}",
  "paperTitle": "${subjectName} Question Paper",
  "isScanned": ${isScannedPdf},
  "questions": [
    {
      "questionNumber": "1(a)",
      "questionText": "Solve the given differential equation (D^2 + 4)y = sin(2x).",
      "marks": 10,
      "detectedUnit": "Unit 2: Ordinary Differential Equations",
      "matchedTopic": "Higher Order Linear Differential Equations",
      "secondaryTopics": ["Particular Integrals", "Trigonometric Forcing"],
      "isExplicitSyllabusMatch": true,
      "confidence": "high"
    }
  ]
}
${extractedText ? `\n\nQUESTION PAPER RAW TEXT CONTENT:\n${extractedText.slice(0, 45000)}` : ""}
`;

  let contents;
  if (fileBuffer && isScannedPdf) {
    contents = [
      {
        inlineData: {
          mimeType: mimeType || "application/pdf",
          data: fileBuffer.toString("base64"),
        },
      },
      prompt,
    ];
  } else {
    contents = prompt;
  }

  // Candidate models with fast failover (gemini-3.5-flash handles multimodal PDFs with high accuracy)
  const candidateModels = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    process.env.GEMINI_MODEL,
    "gemini-3.8-flash",
  ].filter(Boolean);

  const uniqueModels = [...new Set(candidateModels)];

  for (const model of uniqueModels) {
    try {
      console.log(`Extracting PYQ questions using Gemini model: ${model}...`);
      const currentApiKey = (process.env.GEMINI_API_KEY || "").trim();
      const client = new GoogleGenAI({ apiKey: currentApiKey });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Gemini request timeout (60s)")), 60000)
      );

      const response = await Promise.race([
        client.models.generateContent({ model, contents }),
        timeoutPromise
      ]);

      const responseText = response.text;
      if (responseText && responseText.trim().length > 20) {
        let cleaned = responseText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleaned = cleaned.slice(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(cleaned);
        if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          console.log(`Successfully extracted ${parsed.questions.length} questions from ${filename} using ${model}`);
          
          return {
            paperYear: parsed.paperYear || year || "Unknown",
            paperTitle: parsed.paperTitle || filename,
            isScannedPdf,
            questions: parsed.questions.map((q, idx) => ({
              id: `q_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 6)}`,
              questionNumber: q.questionNumber || `Q${idx + 1}`,
              questionText: q.questionText || "Question text unavailable",
              marks: typeof q.marks === "number" ? q.marks : null,
              detectedUnit: q.detectedUnit || "General",
              matchedTopic: q.matchedTopic || "Core Concepts",
              secondaryTopics: Array.isArray(q.secondaryTopics) ? q.secondaryTopics : [],
              isExplicitSyllabusMatch: !!q.isExplicitSyllabusMatch,
              isAiInferred: !q.isExplicitSyllabusMatch,
              confidence: q.confidence || "medium",
              paperYear: year || "Unknown",
              isUserCorrected: false
            }))
          };
        }
      }
    } catch (modelErr) {
      console.warn(`Gemini extraction failed on model ${model}:`, modelErr.message);
    }
  }

  // Fallback to heuristic parser
  console.warn("Falling back to heuristic question extractor for:", filename);
  const fallbackQuestions = heuristicQuestionParser(extractedText, year, filename, syllabusUnits);

  return {
    paperYear: year || "Unknown",
    paperTitle: filename,
    isScannedPdf,
    questions: fallbackQuestions
  };
}

module.exports = {
  extractQuestionsFromPaper,
  heuristicQuestionParser
};
