require("dotenv").config();
const assert = require("assert");
const http = require("http");
const {
  PASS_THRESHOLD,
  TOTAL_QUESTIONS,
  validateQuestionsSchema,
  generateHeuristicMCQs,
} = require("./services/assessmentService");

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest({ method = "GET", path = "/", headers = {}, body = null, cookie = "" }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    if (cookie) reqHeaders["Cookie"] = cookie;

    let payload = body;
    if (body && typeof body === "object" && !Buffer.isBuffer(body) && !headers["Content-Type"]) {
      payload = JSON.stringify(body);
      reqHeaders["Content-Type"] = "application/json";
    }

    if (payload && !reqHeaders["Content-Length"]) {
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          let jsonBody = null;
          try {
            jsonBody = JSON.parse(rawBody);
          } catch (e) {}

          const setCookie = res.headers["set-cookie"];
          let newCookie = cookie;
          if (setCookie && setCookie.length) {
            newCookie = setCookie[0].split(";")[0];
          }

          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: jsonBody || rawBody,
            cookie: newCookie,
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runAssessmentTests() {
  console.log("\n============================================================");
  console.log("   STUDYFLOW v2.0 - TOPIC ASSESSMENT & AUTO-COMPLETION TESTS");
  console.log("============================================================\n");

  // ─── TEST 1: 10-MCQ Schema Validation ───────────────────────
  console.log("Test 1: Schema Validation (FR-03)...");
  
  // Test invalid: less than 10
  const invalidShort = [{ id: "q1", questionText: "Too few", options: [{ id: "A", text: "1" }], correctOptionId: "A" }];
  const valShort = validateQuestionsSchema(invalidShort);
  assert.strictEqual(valShort.valid, false, "Must reject fewer than 10 questions");

  // Test valid heuristic 10 questions
  const valid10 = generateHeuristicMCQs("Cache Memory & Mapping", "Computer Organization", [
    { paperYear: "2024", paperName: "CS2024.pdf", questionNumber: "3", marks: 10, questionText: "Explain direct mapping and associative cache mapping." }
  ]);
  assert.strictEqual(valid10.length, 10, "Heuristic generator must produce exactly 10 questions");
  const val10 = validateQuestionsSchema(valid10);
  assert.strictEqual(val10.valid, true, `Validation error: ${val10.error}`);
  
  // Verify provenance grounding
  const pyqGrounded = valid10.filter(q => q.provenance === "pyq");
  assert(pyqGrounded.length > 0, "Questions grounded in authentic PYQs must have provenance: pyq");
  assert(pyqGrounded[0].pyqReference.includes("2024"), "PYQ reference must include paper year without fabricating");
  console.log("✓ Test 1 Passed: 10-question schema and authentic PYQ provenance verified.");

  // ─── TEST 2: User Creation, Email Verification & Setup ─────────
  console.log("\nTest 2: User Registration & Study Planner Setup...");
  const testEmail = `assessment_student_${Date.now()}@studyflow.test`;
  const testPassword = "StrongPassword123!";

  // 1. Signup
  const signupRes = await makeRequest({
    method: "POST",
    path: "/api/auth/signup",
    body: {
      name: "Assessment Tester",
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
    },
  });
  assert(signupRes.status === 200 || signupRes.status === 201, "User signup must succeed");
  console.log("✓ User registered:", testEmail);

  // 2. Email Verification via devLink
  if (signupRes.body.devLink) {
    const tokenMatch = signupRes.body.devLink.match(/token=([a-f0-9]+)/);
    if (tokenMatch) {
      const verifyRes = await makeRequest({
        method: "GET",
        path: `/api/auth/verify-email?token=${tokenMatch[1]}`,
      });
      assert.strictEqual(verifyRes.status, 200, "Email verification must return 200");
      console.log("✓ Email verified successfully");
    }
  }

  // 3. Login
  const loginRes = await makeRequest({
    method: "POST",
    path: "/api/auth/login",
    body: { email: testEmail, password: testPassword },
  });
  assert.strictEqual(loginRes.status, 200, "Login must succeed");
  const sessionCookie = loginRes.cookie;
  const authToken = loginRes.body.token;
  const authHeaders = {
    Authorization: `Bearer ${authToken}`,
  };

  const testSubjectId = `sub_${Date.now()}`;
  const testTopicId = `ses_${Date.now()}_cache`;

  // 4. Save Syllabus with topic via API
  const savePlanRes = await makeRequest({
    method: "POST",
    path: "/api/user/data",
    cookie: sessionCookie,
    headers: authHeaders,
    body: {
      subjects: [
        {
          id: testSubjectId,
          name: "Computer Organization and Architecture",
          color: "#4f46e5",
          units: [
            {
              unitNumber: 4,
              title: "Memory System",
              topics: ["Cache Memory & Mapping Techniques"],
            },
          ],
        },
      ],
      sessions: [
        {
          id: testTopicId,
          subjectId: testSubjectId,
          topic: "Unit 4: Cache Memory & Mapping Techniques",
          hours: 2.5,
          difficulty: "hard",
          date: "2026-10-25",
          status: "pending",
        },
      ],
    },
  });
  assert.strictEqual(savePlanRes.status, 200, "Study planner data must be saved");
  console.log("✓ Test 2 Passed: User authenticated and study planner configured.");

  // ─── TEST 3: Retrieve Assessment - Answer Key NOT Exposed (FR-04) ───
  console.log("\nTest 3: Retrieve Assessment via API (Checking answer key concealment)...");
  const getQuizRes = await makeRequest({
    method: "GET",
    path: `/api/topics/${testTopicId}/assessment`,
    cookie: sessionCookie,
    headers: authHeaders,
  });

  assert.strictEqual(getQuizRes.status, 200, "Get assessment must return 200");
  assert(getQuizRes.body.success, "Response success must be true");
  const assessmentData = getQuizRes.body.data;
  assert.strictEqual(assessmentData.questions.length, 10, "Must return exactly 10 questions");
  assert.strictEqual(assessmentData.passThreshold, 8, "Pass threshold must be 8");

  // Critical Security Check: Ensure correctOptionId and explanation are NOT returned!
  for (const q of assessmentData.questions) {
    assert.strictEqual(q.correctOptionId, undefined, "Security: correctOptionId must NOT be sent to client");
    assert.strictEqual(q.explanation, undefined, "Security: explanation must NOT be sent to client before submission");
    assert.strictEqual(q.options.length, 4, "Must have 4 options");
  }
  console.log("✓ Test 3 Passed: 10 questions retrieved with answer key securely stripped.");

  // ─── TEST 4: Submit Failing Assessment (7/10 or lower -> Needs Revision) ───
  console.log("\nTest 4: Failing Assessment Scoring & 'You need revision' Rule (FR-05, FR-07)...");

  // Submit all "A"s to test deterministic scoring
  const testAnswersAllA = {};
  assessmentData.questions.forEach(q => {
    testAnswersAllA[q.id] = "A";
  });

  const failSubmitRes = await makeRequest({
    method: "POST",
    path: `/api/topics/${testTopicId}/assessment/attempts`,
    cookie: sessionCookie,
    headers: authHeaders,
    body: {
      quizId: assessmentData.quizId,
      answers: testAnswersAllA,
    },
  });

  assert.strictEqual(failSubmitRes.status, 200, "Submission must return 200");
  const attemptResult1 = failSubmitRes.body.data;
  assert(attemptResult1.score !== undefined, "Score must be calculated");
  assert.strictEqual(attemptResult1.totalQuestions, 10, "Total questions must be 10");

  // If score < 8, must fail and display "You need revision"
  if (attemptResult1.score <= 7) {
    assert.strictEqual(attemptResult1.passed, false, "Result must be failed (score < 8)");
    assert.strictEqual(attemptResult1.status, "needs_revision", "Status must be 'needs_revision'");
    assert(failSubmitRes.body.message.includes("You need revision"), "Message must contain 'You need revision'");
    assert.strictEqual(attemptResult1.weakConcepts.length > 0, true, "Weak concepts must be identified");
  }
  console.log(`✓ Test 4 Passed: Attempt 1 scored ${attemptResult1.score}/10. Status: ${attemptResult1.status}. Result explanation provided.`);

  // ─── TEST 5: Direct Tampering Prevention (FR-06) ─────────────
  console.log("\nTest 5: Protection Against Client Tampering (FR-06)...");
  // Try sending a direct API request to /api/user/data claiming status: "done"
  const spoofRes = await makeRequest({
    method: "POST",
    path: "/api/user/data",
    cookie: sessionCookie,
    headers: authHeaders,
    body: {
      sessions: [
        {
          id: testTopicId,
          subjectId: testSubjectId,
          topic: "Unit 4: Cache Memory & Mapping Techniques",
          status: "done", // Client attempts to forge completion!
        },
      ],
    },
  });

  assert.strictEqual(spoofRes.status, 200);
  const returnedSessions = spoofRes.body.data.sessions;
  const targetSession = returnedSessions.find(s => s.id === testTopicId);
  // Topic has not yet recorded a qualifying passing attempt, so backend MUST revert "done"
  assert.notStrictEqual(targetSession.status, "done", "Security: Backend must REVERT unauthorized completion claims!");
  console.log(`✓ Test 5 Passed: Client spoofing prevented; status reverted to "${targetSession.status}".`);

  // ─── TEST 6: Perfect Passing Assessment (10/10 -> Auto-Completion & Email) ───
  console.log("\nTest 6: Passing Assessment, Auto-Completion & Achievement Flow (FR-05, FR-06, FR-08)...");

  // Extract the question breakdown from attempt 1 to know the exact correct answer for every question
  const perfectAnswers = {};
  attemptResult1.questionBreakdown.forEach(item => {
    perfectAnswers[item.questionId] = item.correctOptionId;
  });

  const passSubmitRes = await makeRequest({
    method: "POST",
    path: `/api/topics/${testTopicId}/assessment/attempts`,
    cookie: sessionCookie,
    headers: authHeaders,
    body: {
      quizId: assessmentData.quizId,
      answers: perfectAnswers,
    },
  });

  assert.strictEqual(passSubmitRes.status, 200);
  const passData = passSubmitRes.body.data;
  assert.strictEqual(passData.score, 10, "Score must be 10/10");
  assert.strictEqual(passData.passed, true, "Must be passed");
  assert.strictEqual(passData.status, "completed", "Topic status must be 'completed'");
  assert(passData.qualifyingAttemptId, "Qualifying attempt ID must be assigned");

  // Verify backend topic progress via authoritative GET endpoint
  const getProgRes = await makeRequest({
    method: "GET",
    path: `/api/topics/${testTopicId}/progress`,
    cookie: sessionCookie,
    headers: authHeaders,
  });
  assert.strictEqual(getProgRes.status, 200);
  assert.strictEqual(getProgRes.body.data.status, "completed", "Authoritative topic progress must be completed");
  assert.strictEqual(getProgRes.body.data.bestScore, 10, "Best score must be 10");

  // Verify user study data session updated to 'done'
  const finalUserDataRes = await makeRequest({
    method: "GET",
    path: "/api/user/data",
    cookie: sessionCookie,
    headers: authHeaders,
  });
  const completedSession = finalUserDataRes.body.data.sessions.find(s => s.id === testTopicId);
  assert.strictEqual(completedSession.status, "done", "Session must be automatically marked 'done' on backend");

  // Verify notification was recorded and attempted
  assert(
    passData.notification.status === "sent" || passData.notification.status === "dev_logged",
    `Notification status should be sent or dev_logged, got ${passData.notification.status}`
  );
  console.log(`✓ Test 6 Passed: 10/10 automatically completed topic with notification status "${passData.notification.status}".`);

  // ─── TEST 7: Idempotency - Duplicate Submission Does NOT Duplicate Email ───
  console.log("\nTest 7: Idempotent Notification (Duplicate Submission Check)...");
  const repeatSubmitRes = await makeRequest({
    method: "POST",
    path: `/api/topics/${testTopicId}/assessment/attempts`,
    cookie: sessionCookie,
    headers: authHeaders,
    body: {
      quizId: assessmentData.quizId,
      answers: perfectAnswers,
    },
  });
  assert.strictEqual(repeatSubmitRes.status, 200);

  const notifListRes = await makeRequest({
    method: "GET",
    path: "/api/notifications",
    cookie: sessionCookie,
    headers: authHeaders,
  });
  assert.strictEqual(notifListRes.status, 200);
  const achievementNotifs = notifListRes.body.data.history.filter(n => n.topicId === testTopicId);
  assert.strictEqual(achievementNotifs.length, 1, "Must maintain exactly 1 notification event (no duplicate emails)");
  console.log("✓ Test 7 Passed: Idempotency verified; duplicate submission did not create duplicate notification.");

  // ─── TEST 8: Attempt History Persistence (FR-10) ─────────────
  console.log("\nTest 8: Attempt History Persistence...");
  const attemptsHistoryRes = await makeRequest({
    method: "GET",
    path: `/api/topics/${testTopicId}/assessment/attempts`,
    cookie: sessionCookie,
    headers: authHeaders,
  });
  assert.strictEqual(attemptsHistoryRes.status, 200);
  assert(attemptsHistoryRes.body.data.attempts.length >= 2, "Must persist all past attempts");
  console.log(`✓ Test 8 Passed: ${attemptsHistoryRes.body.data.attempts.length} attempts persisted in topic history.`);

  // ─── TEST 9: PYQ Practice Next Step (FR-09) ─────────────────
  console.log("\nTest 9: Next-Step PYQ Practice Flow...");
  const pyqNextStepRes = await makeRequest({
    method: "GET",
    path: `/api/topics/${testTopicId}/pyqs`,
    cookie: sessionCookie,
    headers: authHeaders,
  });
  assert.strictEqual(pyqNextStepRes.status, 200);
  assert(pyqNextStepRes.body.data, "Must return PYQ data object");

  // Record practice progress
  const practiceUpdateRes = await makeRequest({
    method: "POST",
    path: `/api/topics/${testTopicId}/pyqs/practice`,
    cookie: sessionCookie,
    headers: authHeaders,
    body: { status: "completed" },
  });
  assert.strictEqual(practiceUpdateRes.status, 200);
  assert.strictEqual(practiceUpdateRes.body.data.pyqPracticeStatus, "completed");
  console.log("✓ Test 9 Passed: PYQ practice tracking works as expected.");

  // ─── TEST 10: Notification Preferences Endpoint ───────────────
  console.log("\nTest 10: Notification Preferences Update...");
  const prefRes = await makeRequest({
    method: "PATCH",
    path: "/api/settings/notifications",
    cookie: sessionCookie,
    headers: authHeaders,
    body: { achievementEmails: false },
  });
  assert.strictEqual(prefRes.status, 200);
  assert.strictEqual(prefRes.body.data.achievementEmails, false, "Preference must be set to false");
  console.log("✓ Test 10 Passed: Notification preferences successfully updated.");

  console.log("\n============================================================");
  console.log("       ALL 10 BACKEND & INTEGRATION TESTS PASSED! ✓");
  console.log("============================================================\n");
}

runAssessmentTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
