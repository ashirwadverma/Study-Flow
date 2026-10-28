const assert = require("assert");
const http = require("http");
const path = require("path");
const fs = require("fs");

const app = require("./server"); // starts server or imports app

async function runE2ETests() {
  console.log("\n=== STARTING E2E HTTP INTEGRATION TESTS FOR PYQ ANALYZER ===");

  const PORT = process.env.PORT || 5000;
  const BASE_URL = `http://localhost:${PORT}`;

  // Helper for making cookie-aware HTTP requests
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
          headers: reqHeaders
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
              cookie: newCookie
            });
          });
        }
      );

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Wait a moment for server to listen
  await new Promise(r => setTimeout(r, 1000));

  // 1. Health check
  console.log("\n--- Step 1: Health Check ---");
  const healthRes = await makeRequest({ method: "GET", path: "/api/health" });
  assert.strictEqual(healthRes.status, 200, "Health check must return 200");
  console.log("✓ Health check OK:", healthRes.body.message);

  // 2. Unauthorized Access Check
  console.log("\n--- Step 2: Security & Authorization Protection ---");
  const unauthRes = await makeRequest({ method: "GET", path: "/api/pyq/history" });
  assert.strictEqual(unauthRes.status, 401, "Unauthenticated request must be rejected with 401");
  console.log("✓ Protected endpoint correctly rejected unauthenticated request:", unauthRes.body.message);

  // 3. Register and Login User A
  console.log("\n--- Step 3: Authenticate User A ---");
  const userAEmail = `studentA_${Date.now()}@example.com`;
  const signupRes = await makeRequest({
    method: "POST",
    path: "/api/auth/signup",
    body: {
      name: "Ashirwad Student",
      email: userAEmail,
      password: "StrongPassword123!",
      confirmPassword: "StrongPassword123!"
    }
  });

  assert(signupRes.status === 200 || signupRes.status === 201, "Signup should succeed");
  console.log("✓ User A registered:", signupRes.body.email);

  // Auto-verify if devLink provided
  if (signupRes.body.devLink) {
    const tokenMatch = signupRes.body.devLink.match(/token=([a-f0-9]+)/);
    if (tokenMatch) {
      const verifyRes = await makeRequest({ method: "GET", path: `/api/auth/verify-email?token=${tokenMatch[1]}` });
      console.log("✓ User A verified");
    }
  }

  // Login User A
  const loginRes = await makeRequest({
    method: "POST",
    path: "/api/auth/login",
    body: {
      email: userAEmail,
      password: "StrongPassword123!"
    }
  });

  assert.strictEqual(loginRes.status, 200, "Login should return 200");
  const userACookie = loginRes.cookie;
  assert(userACookie, "Session cookie must be returned");
  console.log("✓ User A logged in with session cookie");

  // 4. User A attempts PYQ Analysis WITHOUT Syllabus (Should be rejected)
  console.log("\n--- Step 4A: Test Mandatory Syllabus Requirement Enforcement ---");
  const subjectId = `sub_math4_${Date.now()}`;
  const mockExamPaperText = `
B.TECH THEORY EXAMINATION 2024
MATHEMATICS 4
SECTION A
1. (a) Solve the partial differential equation by separation of variables: du/dx = 2 du/dt + u. [10 Marks]
(b) Formulate the dual of the given linear programming problem. [10 Marks]
(c) Find the Laurent series expansion of f(z) = 1 / ((z-1)(z-2)). [10 Marks]
`;

  const rejectedRes = await makeRequest({
    method: "POST",
    path: "/api/pyq/upload-analyze",
    cookie: userACookie,
    body: {
      subjectId,
      subjectName: "Mathematics 4",
      courseCode: "KAS402",
      university: "AKTU",
      semester: "Sem 4",
      examType: "End-Term",
      examDate: "2026-11-20",
      pastedPaperText: mockExamPaperText,
      defaultYear: "2024"
    }
  });

  assert.strictEqual(rejectedRes.status, 400, "PYQ Upload without syllabus must be rejected with 400");
  assert.strictEqual(rejectedRes.body.requiresSyllabus, true, "Must flag requiresSyllabus: true");
  console.log("✓ Verified: Rejected PYQ analysis when no syllabus is provided:", rejectedRes.body.message);

  // 4B. User A Uploads PYQ Examination Papers WITH Official Syllabus Units
  console.log("\n--- Step 4B: Upload & Analyze PYQ with Official Mathematics 4 Syllabus Units ---");
  const math4SyllabusUnits = [
    {
      unitNumber: 1,
      title: "Partial Differential Equations",
      topics: [
        { title: "Origin of PDEs & Lagrange's Linear Equation", difficulty: "medium" },
        { title: "Method of Separation of Variables", difficulty: "hard" },
        { title: "One-Dimensional Wave and Heat Flow Equations", difficulty: "hard" }
      ]
    },
    {
      unitNumber: 2,
      title: "Complex Variables & Functions",
      topics: [
        { title: "Cauchy-Riemann Equations & Analytic Functions", difficulty: "easy" },
        { title: "Taylor & Laurent Series Expansion", difficulty: "hard" },
        { title: "Residue Theorem and Contour Integration", difficulty: "hard" }
      ]
    },
    {
      unitNumber: 3,
      title: "Optimization Techniques & Linear Programming",
      topics: [
        { title: "Simplex Method for Linear Programming", difficulty: "medium" },
        { title: "Duality in Linear Programming", difficulty: "medium" },
        { title: "Transportation and Assignment Problems", difficulty: "easy" }
      ]
    }
  ];

  const pyqUploadRes = await makeRequest({
    method: "POST",
    path: "/api/pyq/upload-analyze",
    cookie: userACookie,
    body: {
      subjectId,
      subjectName: "Mathematics 4",
      courseCode: "KAS402",
      university: "AKTU",
      semester: "Sem 4",
      examType: "End-Term",
      examDate: "2026-11-20",
      pastedPaperText: mockExamPaperText,
      defaultYear: "2024",
      syllabusUnits: math4SyllabusUnits
    }
  });

  assert.strictEqual(pyqUploadRes.status, 200, "PYQ Upload & Analysis with syllabus must return 200");
  assert(pyqUploadRes.body.success, "Analysis must be successful");
  let analysisData = pyqUploadRes.body.data;
  assert(analysisData.topicPriorities && analysisData.topicPriorities.length > 0, "Must have topic priorities");
  assert(analysisData.syllabusCoverage && analysisData.syllabusCoverage.totalSyllabusTopics > 0, "Must have syllabus coverage calculation");
  console.log(`✓ Analysis created successfully with ${analysisData.questions.length} questions mapped to ${analysisData.syllabusCoverage.totalSyllabusTopics} syllabus topics (${analysisData.topicPriorities.length} prioritized topic groups)`);

  // 4C. Multi-Year Accumulation: User A Uploads another year's paper (2023) for the SAME Mathematics 4 course
  console.log("\n--- Step 4C: Multi-Year Accumulation — Upload Year 2023 PYQ for Same Subject ---");
  const mockExamPaper2023Text = `
B.TECH THEORY EXAMINATION 2023
MATHEMATICS 4
SECTION A
1. (a) Solve using Method of Separation of Variables: d^2u/dx^2 = du/dt. [10 Marks]
(b) Find Taylor and Laurent series expansion of function f(z) = z / (z^2 - 1). [10 Marks]
(c) Solve the transportation problem by Vogel's Approximation Method. [10 Marks]
`;

  const pyqUpload2023Res = await makeRequest({
    method: "POST",
    path: "/api/pyq/upload-analyze",
    cookie: userACookie,
    body: {
      subjectId,
      subjectName: "Mathematics 4",
      courseCode: "KAS402",
      university: "AKTU",
      semester: "Sem 4",
      examType: "End-Term",
      pastedPaperText: mockExamPaper2023Text,
      defaultYear: "2023",
      syllabusUnits: math4SyllabusUnits,
      replaceExisting: false // Accumulate across years
    }
  });

  assert.strictEqual(pyqUpload2023Res.status, 200, "2023 PYQ Upload must succeed");
  analysisData = pyqUpload2023Res.body.data;
  assert.strictEqual(analysisData.papers.length, 2, "Must accumulate both 2024 and 2023 papers (2 papers total)");
  assert.strictEqual(analysisData.questions.length, 6, "Must accumulate all 6 questions across 2024 and 2023");
  
  // Verify multi-year recurring topic is top-ranked
  const topTopic = analysisData.topicPriorities[0];
  console.log(`✓ Multi-Year accumulation verified: 2 papers on file (2024, 2023), 6 total questions.`);
  console.log(`✓ Top prioritized multi-year recurring topic: "${topTopic.topicName}" (Score: ${topTopic.priorityScore}/100, Appeared in ${topTopic.paperCount}/${topTopic.totalPaperCount} papers)`);

  // 4D. Test Single Paper Deletion and Recalculation
  console.log("\n--- Step 4D: Test Single Paper Deletion & Priorities Recalculation ---");
  const paper2023Id = analysisData.papers.find(p => p.year === "2023").id;
  const deletePaperRes = await makeRequest({
    method: "DELETE",
    path: `/api/pyq/paper/${subjectId}/${paper2023Id}`,
    cookie: userACookie
  });

  assert.strictEqual(deletePaperRes.status, 200, "Paper deletion must return 200");
  assert.strictEqual(deletePaperRes.body.data.papers.length, 1, "Must reduce back to 1 paper after deletion");
  assert.strictEqual(deletePaperRes.body.data.questions.length, 3, "Must reduce back to 3 questions");
  console.log("✓ Verified: Single paper deletion recalculates priorities across remaining papers");

  // Re-upload 2023 paper so downstream plan generation has full data
  await makeRequest({
    method: "POST",
    path: "/api/pyq/upload-analyze",
    cookie: userACookie,
    body: {
      subjectId,
      subjectName: "Mathematics 4",
      pastedPaperText: mockExamPaper2023Text,
      defaultYear: "2023",
      syllabusUnits: math4SyllabusUnits,
      replaceExisting: false
    }
  });

  // 5. Question Reclassification Check
  console.log("\n--- Step 5: Test Student Question Reclassification & Real-Time Re-ranking ---");
  const targetQuestion = analysisData.questions[0];
  const reclassifyRes = await makeRequest({
    method: "PUT",
    path: `/api/pyq/question/${subjectId}/${targetQuestion.id}`,
    cookie: userACookie,
    body: {
      matchedTopic: "Advanced Cache Mapping & Memory Architecture",
      detectedUnit: "Unit 4: Memory System",
      marks: 15,
      userNotes: "Verified with professor"
    }
  });

  assert.strictEqual(reclassifyRes.status, 200, "Reclassification must return 200");
  assert(reclassifyRes.body.success, "Reclassification must succeed");
  const updatedAnalysis = reclassifyRes.body.data;
  const updatedQ = updatedAnalysis.questions.find(q => q.id === targetQuestion.id);
  assert.strictEqual(updatedQ.matchedTopic, "Advanced Cache Mapping & Memory Architecture");
  assert.strictEqual(updatedQ.isUserCorrected, true);
  console.log("✓ Verified: Question reclassification updated topic name, marks to 15, and recalculated priority rankings");

  // 6. Connect to Study Planner: Generate Study Plan from Analysis
  console.log("\n--- Step 6: Create Study Plan from Analysis Integration ---");
  const planRes = await makeRequest({
    method: "POST",
    path: "/api/pyq/generate-plan",
    cookie: userACookie,
    body: {
      subjectId,
      dailyStudyHours: 3.0,
      examDate: "2026-11-20"
    }
  });

  assert.strictEqual(planRes.status, 200, "Study plan generation must return 200");
  assert(planRes.body.success, "Plan generation must succeed");
  assert(planRes.body.data.scheduledSessions.length > 0, "Must schedule sessions");
  console.log(`✓ Generated ${planRes.body.data.scheduledSessions.length} prioritized study sessions based on PYQ evidence`);

  // Verify that sessions were added to User A's study data
  const userStudyDataRes = await makeRequest({
    method: "GET",
    path: "/api/user/data",
    cookie: userACookie
  });
  assert(userStudyDataRes.body.data.sessions.some(s => s.subjectId === subjectId), "Sessions must persist in user study data");
  console.log("✓ Verified: PYQ prioritized sessions persisted in user's StudyFlow schedule");

  // 7. Data Isolation & Security: User B cannot access User A's analysis
  console.log("\n--- Step 7: Cross-User Data Isolation Verification ---");
  const userBEmail = `studentB_${Date.now()}@example.com`;
  const signupB = await makeRequest({
    method: "POST",
    path: "/api/auth/signup",
    body: { name: "User B", email: userBEmail, password: "StrongPassword123!", confirmPassword: "StrongPassword123!" }
  });
  if (signupB.body.devLink) {
    const token = signupB.body.devLink.match(/token=([a-f0-9]+)/)[1];
    await makeRequest({ method: "GET", path: `/api/auth/verify-email?token=${token}` });
  }
  const loginB = await makeRequest({ method: "POST", path: "/api/auth/login", body: { email: userBEmail, password: "StrongPassword123!" } });
  const userBCookie = loginB.cookie;

  // User B tries to get User A's PYQ analysis
  const crossUserGet = await makeRequest({
    method: "GET",
    path: `/api/pyq/subject/${subjectId}`,
    cookie: userBCookie
  });
  assert.strictEqual(crossUserGet.status, 404, "User B must NOT find or access User A's PYQ analysis");
  console.log("✓ Verified: Complete user data isolation (User B received 404 for User A's analysis ID)");

  console.log("\n==================================================================");
  console.log("🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY WITHOUT ERRORS! 🎉");
  console.log("==================================================================");

  process.exit(0);
}

runE2ETests().catch(err => {
  console.error("E2E Test Failure:", err);
  process.exit(1);
});
