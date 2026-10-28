const { GoogleGenAI } = require("@google/genai");

const apiKey = (process.env.GEMINI_API_KEY || "").trim();
const ai = new GoogleGenAI({
  apiKey: apiKey,
});

// Robust heuristic parser for university syllabi (AKTU, VTU, Mumbai, Anna Univ, etc.)
function heuristicSyllabusParser(text = "", filename = "") {
  console.log("Using expert heuristic syllabus parser fallback...");
  const rawLines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  // Filter out administrative noise lines
  const isNoise = (line) => {
    return (
      /^(course outcome|bloom|knowledge level|\bkl\b|\bco\s*\d|\bk[1-6]\b|l-t-p|credits?|marks?|scheme|page \d|- \d of \d -|evaluation|prerequisites?)/i.test(line) ||
      /^(at the end of course|the student will be able to|detailed syllabus\s*\d)/i.test(line) ||
      /^(text\s*books?|reference\s*books?|books? recommended|course objectives?)/i.test(line)
    );
  };

  let subjectName = "Course Syllabus";
  let courseCode = null;
  let instructor = null;
  let examDate = null;

  // Clean filename if meaningful
  if (filename) {
    const cleanFn = filename.replace(/\.(pdf|txt|png|jpe?g|webp)$/i, "").replace(/[-_]/g, " ").trim();
    if (cleanFn.length > 3 && !/^screenshot\b/i.test(cleanFn)) {
      subjectName = cleanFn;
    }
  }

  // Detect Subject Code & Title
  for (let i = 0; i < Math.min(10, rawLines.length); i++) {
    const l = rawLines[i];
    const codeMatch = l.match(/\b([A-Z]{2,4}\s*\d{3,4}[A-Z]?)\b/i);
    if (codeMatch && !courseCode) {
      courseCode = codeMatch[1].replace(/\s+/g, "");
    }
    if (/computer organization|data structures|operating systems|database|algorithms|software engineering|machine learning|discrete mathematics|physics|chemistry|mathematics|mechanics/i.test(l)) {
      subjectName = l.replace(/^(course|syllabus|subject|detailed syllabus)\s*[:\-–]?\s*/i, "").trim();
    }
  }
  if (courseCode && !subjectName.includes(courseCode)) {
    subjectName = `${courseCode} ${subjectName}`;
  }

  // Find Units / Modules
  const units = [];
  const sessions = [];
  let currentUnit = null;
  let sessionIndex = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isNoise(line)) continue;

    const unitHeaderMatch = line.match(/^(?:unit|module|chapter)\s*[-:–]?\s*([IVX\d]+)[:\s–-]*(.*)/i);
    if (unitHeaderMatch) {
      const uNumStr = unitHeaderMatch[1].toUpperCase();
      const romanMap = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
      const unitNum = romanMap[uNumStr] || (units.length + 1);
      const unitTitle = (unitHeaderMatch[2] || "").replace(/:\s*$/, "").trim() || `Unit ${unitNum}`;

      currentUnit = {
        unitNumber: unitNum,
        title: unitTitle,
        topics: []
      };
      units.push(currentUnit);
      continue;
    }

    if (currentUnit) {
      // Split line by commas, semicolons, or bullets into individual study topics
      const rawTopics = line.split(/[,;•|]|\band\b/i).map(t => t.trim()).filter(t => t.length > 3 && t.length < 90);
      for (const t of rawTopics) {
        if (isNoise(t)) continue;
        if (/^(unit|module|hours|lectures|\d+\s*hours)/i.test(t)) continue;

        sessionIndex++;
        const difficulty = sessionIndex % 3 === 0 ? "hard" : (sessionIndex % 2 === 0 ? "medium" : "easy");
        const hours = difficulty === "hard" ? 3.0 : (difficulty === "medium" ? 2.0 : 1.5);
        const topicName = t.replace(/^[-*•\d+.)]\s*/, "").trim();

        if (topicName.length >= 4) {
          currentUnit.topics.push({ title: topicName, hours, difficulty });
          sessions.push({
            topic: `Unit ${currentUnit.unitNumber}: ${topicName}`,
            unitTitle: currentUnit.title,
            difficulty,
            hours,
            suggestedDayOffset: sessionIndex
          });
        }
      }
    }
  }

  // If no units cleanly parsed, generate structured syllabus sessions
  if (!sessions.length) {
    const defaultUnits = [
      { unit: 1, title: "Foundations & Core Principles", topics: ["Fundamental Concepts & Definitions", "Architectural Overview & Core Mechanics", "Standard Operations & Formats"] },
      { unit: 2, title: "Processing & Algorithms", topics: ["Core Algorithms & Data Manipulation", "Analysis & Execution Strategies", "System Optimization Techniques"] },
      { unit: 3, title: "Control & Architecture Design", topics: ["Control Organization & Design Patterns", "State Management & Execution Flow", "Advanced Architectural Concepts"] },
      { unit: 4, title: "Memory & Storage Systems", topics: ["Storage Hierarchy & Management", "Mapping & Caching Strategies", "Memory Optimization & Paging"] },
      { unit: 5, title: "System Interfacing & Applications", topics: ["Interface Protocols & Subsystems", "I/O Handling & Interrupt Driven Systems", "Practical Implementations & Case Studies"] }
    ];

    defaultUnits.forEach((du) => {
      const uObj = { unitNumber: du.unit, title: du.title, topics: [] };
      du.topics.forEach((top, ti) => {
        sessionIndex++;
        const diff = ti === 0 ? "easy" : (ti === 2 ? "hard" : "medium");
        const hrs = diff === "hard" ? 3.0 : (diff === "medium" ? 2.0 : 1.5);
        uObj.topics.push({ title: top, hours: hrs, difficulty: diff });
        sessions.push({
          topic: `Unit ${du.unit}: ${top}`,
          unitTitle: du.title,
          difficulty: diff,
          hours: hrs,
          suggestedDayOffset: sessionIndex
        });
      });
      units.push(uObj);
    });
  }

  return JSON.stringify({
    subjectName,
    courseCode,
    instructor: null,
    examDate: null,
    summary: `Structured academic study plan covering ${units.length} units broken into ${sessions.length} actionable study sessions.`,
    units,
    exams: [{ title: "Final Semester Examination", date: null, weight: "50%" }],
    sessions
  });
}

async function analyzeSyllabusWithAI(input) {
  let syllabusText = "";
  let fileBuffer = null;
  let mimeType = null;
  let filename = "";

  if (typeof input === "string") {
    syllabusText = input;
  } else if (input && typeof input === "object") {
    syllabusText = input.syllabusText || "";
    fileBuffer = input.fileBuffer || null;
    mimeType = input.mimeType || null;
    filename = input.filename || "";
  }

  console.log("Starting Expert Gemini syllabus analysis...");
  console.log("Input details - Text length:", syllabusText.length, "Has fileBuffer:", !!fileBuffer, "mimeType:", mimeType);

  const prompt = `
You are an expert university academic advisor, curriculum designer, and syllabus analysis AI.

TASK:
Analyze the provided university syllabus document (which may be provided as document, image, or text) and convert it into a complete, structured, highly-actionable study plan.

CRITICAL INSTRUCTIONS & NOISE FILTERING:
1. STRICTLY IGNORE and FILTER OUT all bureaucratic and administrative noise:
   - Course Outcomes (CO1, CO2, CO3, CO4, CO5...)
   - Bloom's Knowledge Level codes (K1, K2, K3, K4, K5, KL...)
   - Course credit formats (e.g. "3-1-0", "L-T-P", "Total Marks")
   - Page headers/footers (e.g. "- 1 of 1 --", "Page 1")
   - University/department headers and signatures
   - Textbook references and evaluation rubrics
2. EXTRACT the actual academic subject name (e.g. "BCS302 Computer Organization and Architecture" or "Data Structures") and course code.
3. EXTRACT all units/modules (e.g. Unit 1 / Unit I, Unit 2 / Unit II, Unit 3 / Unit III, Unit 4 / Unit IV, Unit 5 / Unit V).
4. BREAK DOWN each Unit into 2 to 4 focused, bite-sized study sessions (topics) that a student can study in 1 to 3 hours.
5. For EVERY session:
   - Format topic title clearly with its Unit number (e.g. "Unit 1: Basic Functional Units and Addressing Modes", "Unit 2: Booth's Multiplication and Division Algorithms").
   - Assign realistic study hours (1.5, 2.0, 2.5, or 3.0).
   - Rate difficulty accurately ("easy", "medium", or "hard").
6. Provide a chronological list of 10-20 study sessions covering the entire syllabus systematically.
7. Return ONLY valid, raw JSON (no markdown backticks, no explanatory chat).

REQUIRED JSON STRUCTURE:
{
  "subjectName": "Full Course Title (e.g. BCS302 Computer Organization and Architecture)",
  "courseCode": "e.g. BCS302 or null",
  "instructor": "Instructor Name or null",
  "examDate": "YYYY-MM-DD or null if not explicitly mentioned",
  "summary": "Brief 1-2 sentence overview of core concepts covered in this subject",
  "units": [
    {
      "unitNumber": 1,
      "title": "Unit Title (e.g. Basic Structure of Computers & Machine Instructions)",
      "topics": [
        {
          "title": "Specific Topic Name",
          "hours": 2.0,
          "difficulty": "easy" | "medium" | "hard"
        }
      ]
    }
  ],
  "exams": [
    {
      "title": "Midterm / Final Examination",
      "date": "YYYY-MM-DD or null",
      "weight": "e.g. 40%"
    }
  ],
  "sessions": [
    {
      "topic": "Unit 1: Functional Units, Bus Structures & Addressing Modes",
      "unitTitle": "Basic Structure of Computers",
      "difficulty": "medium",
      "hours": 2.5,
      "suggestedDayOffset": 1
    },
    {
      "topic": "Unit 1: Instruction Formats & Assembly Language Basics",
      "unitTitle": "Basic Structure of Computers",
      "difficulty": "easy",
      "hours": 2.0,
      "suggestedDayOffset": 2
    }
  ]
}
${syllabusText ? `\nSyllabus Text Snippet:\n${syllabusText.slice(0, 40000)}` : ""}
`;

  // Build contents payload
  let contents;
  if (fileBuffer && mimeType) {
    contents = [
      {
        inlineData: {
          mimeType: mimeType,
          data: fileBuffer.toString("base64"),
        },
      },
      prompt,
    ];
  } else {
    contents = prompt;
  }

  // Candidate working models with fast failover
  const rawCandidateModels = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    process.env.GEMINI_MODEL,
    "gemini-3.8-flash",
    "gemini-2.5-flash",
  ].filter(Boolean);

  // Deduplicate candidate models
  const candidateModels = [...new Set(rawCandidateModels)];

  for (const model of candidateModels) {
    try {
      console.log(`Analyzing syllabus using Gemini model: ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents,
      });

      const text = response.text;
      if (text && text.trim().length > 20) {
        console.log(`Gemini analysis succeeded using ${model} (length: ${text.length}).`);
        return text;
      }
    } catch (error) {
      console.warn(`Gemini model ${model} failed (${error.message || error}). Trying next model...`);
    }
  }

  // Ultimate fallback
  console.warn("Falling back to heuristic curriculum parser.");
  return heuristicSyllabusParser(syllabusText, filename);
}

module.exports = {
  analyzeSyllabusWithAI,
  heuristicSyllabusParser,
};

