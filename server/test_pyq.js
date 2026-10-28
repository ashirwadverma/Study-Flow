const assert = require("assert");
const { calculateTopicPriorities, normalizeTopicName } = require("./services/pyqPrioritization");
const { heuristicQuestionParser } = require("./services/pyqExtractor");

console.log("=== RUNNING PREVIOUS-YEAR QUESTION PAPER ANALYZER TESTS ===");

// ─── TEST 1: Topic Prioritization Algorithm ───────────────────
console.log("\n--- Test 1: Topic Prioritization Algorithm ---");
const mockPapers = [
  { id: "p1", fileName: "2024_CS.pdf", year: "2024" },
  { id: "p2", fileName: "2023_CS.pdf", year: "2023" },
  { id: "p3", fileName: "2022_CS.pdf", year: "2022" }
];

const mockQuestions = [
  // Topic A: Appears in all 3 papers with high marks
  { id: "q1", paperId: "p1", paperYear: "2024", matchedTopic: "Cache Memory & Mapping Techniques", detectedUnit: "Unit 4", marks: 10, isExplicitSyllabusMatch: true },
  { id: "q2", paperId: "p2", paperYear: "2023", matchedTopic: "Cache Memory & Mapping Techniques", detectedUnit: "Unit 4", marks: 10, isExplicitSyllabusMatch: true },
  { id: "q3", paperId: "p3", paperYear: "2022", matchedTopic: "Cache Memory & Mapping Techniques", detectedUnit: "Unit 4", marks: 7, isExplicitSyllabusMatch: true },

  // Topic B: Appears 5 times but only in 2024 paper (single-year burst)
  { id: "q4", paperId: "p1", paperYear: "2024", matchedTopic: "Booth's Multiplication Algorithm", detectedUnit: "Unit 2", marks: 5, isExplicitSyllabusMatch: true },
  { id: "q5", paperId: "p1", paperYear: "2024", matchedTopic: "Booth's Multiplication Algorithm", detectedUnit: "Unit 2", marks: 5, isExplicitSyllabusMatch: true },
  { id: "q6", paperId: "p1", paperYear: "2024", matchedTopic: "Booth's Multiplication Algorithm", detectedUnit: "Unit 2", marks: 2, isExplicitSyllabusMatch: true },

  // Topic C: Appears in 2 papers with unknown marks (null)
  { id: "q7", paperId: "p1", paperYear: "2024", matchedTopic: "Pipelining & Hazards", detectedUnit: "Unit 3", marks: null, isExplicitSyllabusMatch: true },
  { id: "q8", paperId: "p2", paperYear: "2023", matchedTopic: "Pipelining & Hazards", detectedUnit: "Unit 3", marks: null, isExplicitSyllabusMatch: true }
];

const mockSyllabusUnits = [
  { unitNumber: 1, title: "Basic Architecture", topics: [{ title: "Instruction Formats" }] },
  { unitNumber: 2, title: "Arithmetic", topics: [{ title: "Booth's Multiplication Algorithm" }] },
  { unitNumber: 3, title: "Processing Unit", topics: [{ title: "Pipelining & Hazards" }] },
  { unitNumber: 4, title: "Memory System", topics: [{ title: "Cache Memory & Mapping Techniques" }] },
  { unitNumber: 5, title: "I/O Organization", topics: [{ title: "DMA & Interrupts" }] } // Note: Never appeared in papers
];

const result = calculateTopicPriorities(mockQuestions, mockPapers, mockSyllabusUnits, ["Cache Memory & Mapping Techniques"]);

console.log("Topic Priorities calculated:", result.topicPriorities.length);
assert(result.topicPriorities.length > 0, "Should have topic priorities");

const topTopic = result.topicPriorities[0];
console.log(`Top Priority Topic: ${topTopic.topicName} (Score: ${topTopic.priorityScore}, Level: ${topTopic.priorityLevel})`);
assert.strictEqual(topTopic.priorityLevel, "High", "Topic A should be High priority");
assert.strictEqual(topTopic.paperCount, 3, "Topic A should appear in 3 papers");
assert.strictEqual(topTopic.paperFrequencyPercent, 100, "Topic A should have 100% paper frequency");

// Verify that 1 paper with multiple questions (Topic B) doesn't surpass a 3-year consistent topic (Topic A)
const topicB = result.topicPriorities.find(t => t.topicName.includes("Booth"));
assert(topTopic.priorityScore > topicB.priorityScore, "Consistent multi-year topic must rank higher than single-paper burst");
console.log(`✓ Verified: Multi-year consistent topic (${topTopic.priorityScore}) outranked single-year burst (${topicB.priorityScore})`);

// ─── TEST 2: Syllabus Coverage Gap Analysis ───────────────────
console.log("\n--- Test 2: Syllabus Coverage Gap Analysis ---");
assert(result.syllabusCoverage, "Syllabus coverage must exist");
console.log(`Covered Topics: ${result.syllabusCoverage.coveredTopicsCount}, Uncovered Topics: ${result.syllabusCoverage.uncoveredTopicsCount}`);
const uncoveredDMA = result.syllabusCoverage.uncoveredTopics.find(u => u.topicName.includes("DMA"));
assert(uncoveredDMA, "DMA & Interrupts from Unit 5 must be flagged as uncovered in past papers");
console.log(`✓ Verified: Uncovered syllabus topic detected: "${uncoveredDMA.topicName}" (${uncoveredDMA.reason})`);

// ─── TEST 3: Single Paper Honest Recurrence Handling ──────────
console.log("\n--- Test 3: Single Paper Honest Recurrence Handling ---");
const singlePaperResult = calculateTopicPriorities(
  mockQuestions.filter(q => q.paperYear === "2024"),
  [{ id: "p1", fileName: "2024_CS.pdf", year: "2024" }],
  mockSyllabusUnits
);
console.log("Single paper summary note:", singlePaperResult.summaryNote);
assert(singlePaperResult.summaryNote.includes("Historical recurrence cannot be established"), "Must honestly flag single paper limitation");
console.log("✓ Verified: Single paper limitation honestly reported");

// ─── TEST 4: Heuristic Question Paper Parser ──────────────────
console.log("\n--- Test 4: Heuristic Question Paper Parser ---");
const sampleExamText = `
B.TECH. (SEM IV) THEORY EXAMINATION 2023-24
COMPUTER ORGANIZATION AND ARCHITECTURE
Time: 3 Hours                                  Total Marks: 100
Note: Attempt all Sections.

SECTION A
1. Attempt all parts: (2 * 10 = 20)
(a) What are the various addressing modes in 8086? (2 Marks)
(b) Explain Booth's multiplication algorithm with a flow chart. [10 Marks]
(c) Differentiate between SRAM and DRAM memory systems. (5 Marks)

SECTION B
2. Attempt any three of the following: (10 * 3 = 30)
(a) Discuss the direct, associative, and set-associative cache mapping techniques with examples. [10 Marks]
(b) Explain the pipeline hazards and techniques to mitigate data hazards. (10 Marks)
`;

const parsedQuestions = heuristicQuestionParser(sampleExamText, "2024", "aktu_coa_2024.pdf", mockSyllabusUnits);
console.log(`Parsed ${parsedQuestions.length} questions heuristically from sample exam`);
assert(parsedQuestions.length >= 4, "Should extract at least 4 questions");
const cacheQ = parsedQuestions.find(q => q.questionText.toLowerCase().includes("cache mapping"));
assert(cacheQ, "Should extract cache mapping question");
assert.strictEqual(cacheQ.marks, 10, "Should correctly extract 10 marks");
console.log(`✓ Verified heuristic extraction: "${cacheQ.questionText.slice(0, 50)}..." -> Marks: ${cacheQ.marks}, Topic: ${cacheQ.matchedTopic}`);

console.log("\n=== ALL UNIT TESTS PASSED SUCCESSFULLY! ===");
