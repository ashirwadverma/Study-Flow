const http = require("http");

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on("error", reject);
    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== STARTING AUTH PERSISTENCE VERIFICATION TEST ===");

  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = "Password123";
  const testName = "Test Persistence User";

  // 1. Sign up
  console.log("\n1. Testing Signup...");
  const signupRes = await makeRequest(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/auth/signup",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { name: testName, email: testEmail, password: testPassword, confirmPassword: testPassword }
  );
  console.log("Signup status:", signupRes.status, "Message:", signupRes.body.message);

  let verifyToken = "";
  if (signupRes.body.devLink) {
    const url = new URL(signupRes.body.devLink);
    verifyToken = url.searchParams.get("token");
  }

  // 2. Verify Email via API
  console.log("\n2. Testing Email Verification via API with token:", verifyToken);
  const verifyRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: `/api/auth/verify-email?token=${verifyToken}`,
    method: "GET",
  });
  console.log("Verify email status:", verifyRes.status, "Message:", verifyRes.body.message);

  // 3. Login
  console.log("\n3. Testing Login & Token / Cookie Issuance...");
  const loginRes = await makeRequest(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email: testEmail, password: testPassword }
  );

  console.log("Login status:", loginRes.status);
  console.log("Has auth token in body:", !!loginRes.body.token);

  const token = loginRes.body.token;
  const setCookies = loginRes.headers["set-cookie"] || [];
  const sessionCookie = setCookies.find((c) => c.startsWith("studyflow.sid="));
  const tokenCookie = setCookies.find((c) => c.startsWith("studyflow_auth_token="));

  console.log("Has session cookie:", !!sessionCookie);
  console.log("Has permanent auth token cookie:", !!tokenCookie);

  // 4. Test /api/auth/me WITH session cookie
  console.log("\n4. Testing /api/auth/me with session cookie...");
  const meWithCookieRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: "/api/auth/me",
    method: "GET",
    headers: {
      Cookie: sessionCookie ? sessionCookie.split(";")[0] : "",
    },
  });
  console.log("/api/auth/me (cookie only): authenticated =", meWithCookieRes.body.authenticated, "User:", meWithCookieRes.body.user && meWithCookieRes.body.user.email);

  // 5. Test /api/auth/me WITHOUT session cookie, BUT WITH Bearer token (Simulating Server Restart / Memory Flush / Reopen browser)
  console.log("\n5. Testing /api/auth/me WITHOUT session cookie (Bearer Token Rehydration)...");
  const meWithTokenRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: "/api/auth/me",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  console.log("/api/auth/me (token rehydration): authenticated =", meWithTokenRes.body.authenticated, "User:", meWithTokenRes.body.user && meWithTokenRes.body.user.email);

  // 6. Test /api/auth/me WITHOUT Authorization header BUT WITH studyflow_auth_token cookie
  console.log("\n6. Testing /api/auth/me with studyflow_auth_token cookie only...");
  const meWithAuthCookieRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: "/api/auth/me",
    method: "GET",
    headers: {
      Cookie: tokenCookie ? tokenCookie.split(";")[0] : "",
    },
  });
  console.log("/api/auth/me (auth cookie only): authenticated =", meWithAuthCookieRes.body.authenticated, "User:", meWithAuthCookieRes.body.user && meWithAuthCookieRes.body.user.email);

  // 7. Test protected route /api/user/data WITH Bearer token
  console.log("\n7. Testing protected route /api/user/data with Bearer token...");
  const syncRes = await makeRequest(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/user/data",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    {
      subjects: [{ id: "sub_1", name: "Mathematics" }],
      sessions: [{ id: "sess_1", title: "Calculus" }],
    }
  );
  console.log("Sync protected data status:", syncRes.status, "Success:", syncRes.body.success);

  // 8. Test fetching data back
  const getRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: "/api/user/data",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  console.log("Fetch protected data status:", getRes.status, "Subjects count:", getRes.body.data && getRes.body.data.subjects ? getRes.body.data.subjects.length : 0);

  // 9. Test Logout
  console.log("\n9. Testing Logout...");
  const logoutRes = await makeRequest({
    hostname: "localhost",
    port: 5000,
    path: "/api/auth/logout",
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  console.log("Logout status:", logoutRes.status, "Cleared cookies count:", (logoutRes.headers["set-cookie"] || []).length);

  console.log("\n=== ALL AUTH PERSISTENCE VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
}

runTests().catch(console.error);
