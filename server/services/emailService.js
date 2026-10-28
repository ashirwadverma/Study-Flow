const nodemailer = require("nodemailer");

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  // Gmail service shortcut
  if (process.env.EMAIL_SERVICE === "gmail" && user && pass) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });
  }

  // Development mode transporter (logs to console or fallback)
  return null;
}

async function sendVerificationEmail({ email, name, token }) {
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
  const verificationUrl = `${appUrl}/verify-email.html?token=${encodeURIComponent(token)}`;
  const fromAddress = process.env.SMTP_FROM || process.env.EMAIL_FROM || '"StudyFlow Security" <noreply@studyflow.app>';

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0f19; color: #f1f5f9; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 30px auto; background-color: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; text-align: center; }
    .brand-title { color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
    .body-content { padding: 32px 28px; color: #cbd5e1; font-size: 15px; line-height: 1.6; }
    .greeting { font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 12px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .verify-btn { display: inline-block; background: linear-gradient(135deg, #d0ff45, #a3e635); color: #0f172a; font-weight: 800; font-size: 15px; text-decoration: none; padding: 14px 34px; border-radius: 999px; box-shadow: 0 4px 16px rgba(208, 255, 69, 0.35); }
    .alt-link { word-break: break-all; font-size: 12px; color: #818cf8; margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.04); border-radius: 8px; }
    .footer { padding: 20px 28px; background-color: #090d16; border-top: 1px solid rgba(255,255,255,0.06); font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-title">📚 StudyFlow</h1>
    </div>
    <div class="body-content">
      <div class="greeting">Verify your email address, ${escapeHtml(name)} 👋</div>
      <p>Thank you for signing up for <strong>StudyFlow - Syllabus Study Planner</strong>! To protect your account and start organizing your courses, please verify your email address.</p>
      
      <div class="btn-container">
        <a href="${verificationUrl}" target="_blank" class="verify-btn">Verify My Email Address →</a>
      </div>

      <p style="font-size: 13px; color: #94a3b8;">This verification link is single-use and will expire in <strong>24 hours</strong>. If you did not create this account, you can safely ignore this email.</p>

      <p style="margin-top: 24px; font-size: 13px; color: #94a3b8;">If the button above does not work, copy and paste this link into your browser:</p>
      <div class="alt-link">${verificationUrl}</div>
    </div>
    <div class="footer">
      <p>© 2026 StudyFlow. Plan Smarter. Study Better.</p>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
StudyFlow - Email Verification

Hello ${name},

Thank you for signing up for StudyFlow - Syllabus Study Planner!
Please verify your email address by visiting this link:

${verificationUrl}

This link will expire in 24 hours. If you did not sign up, please ignore this message.

Best regards,
The StudyFlow Team
  `;

  const transporter = createTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: "Verify your StudyFlow account",
        text: textContent,
        html: htmlContent,
      });
      console.log(`✓ Verification email sent to: ${email} (MessageId: ${info.messageId})`);
      return { sent: true, provider: "smtp" };
    } catch (err) {
      console.error(`✗ Failed to send email via SMTP: ${err.message}`);
      // Return details so caller knows delivery issue
      return { sent: false, error: err.message, devLink: verificationUrl };
    }
  } else {
    // Development fallback: Log link to terminal for local developer testing
    console.log(`\n======================================================`);
    console.log(`[DEV MODE] Verification link generated for ${email}:`);
    console.log(`${verificationUrl}`);
    console.log(`(Configure SMTP_HOST, SMTP_USER, SMTP_PASS in .env to send real emails)`);
    console.log(`======================================================\n`);
    return { sent: false, devMode: true, devLink: verificationUrl };
  }
}

/**
 * Send Achievement Unlocked Email upon passing topic assessment (score >= 8/10)
 */
async function sendAchievementEmail({ email, name, topicName, subjectName, score, percentage, qualifyingAttemptId }) {
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
  const practiceUrl = `${appUrl}/dashboard.html?tab=pyq&subject=${encodeURIComponent(subjectName || "")}&topic=${encodeURIComponent(topicName || "")}`;
  const fromAddress = process.env.SMTP_FROM || process.env.EMAIL_FROM || '"StudyFlow Achievements" <achievements@studyflow.app>';
  const achievementDate = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `Achievement unlocked! You completed ${topicName} on StudyFlow`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0f19; color: #f1f5f9; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 30px auto; background-color: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #10b981, #059669); padding: 36px 24px; text-align: center; }
    .badge-icon { font-size: 48px; margin-bottom: 8px; display: block; }
    .brand-title { color: #ffffff; font-size: 26px; font-weight: 800; margin: 0; }
    .brand-sub { color: #d1fae5; font-size: 14px; font-weight: 600; margin-top: 4px; }
    .body-content { padding: 32px 28px; color: #cbd5e1; font-size: 15px; line-height: 1.6; }
    .greeting { font-size: 19px; font-weight: 700; color: #ffffff; margin-bottom: 12px; }
    .achievement-card { background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center; }
    .score-badge { font-size: 32px; font-weight: 800; color: #34d399; margin: 4px 0; }
    .score-sub { font-size: 13px; color: #94a3b8; font-weight: 600; }
    .topic-pill { display: inline-block; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #c7d2fe; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; margin-bottom: 10px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .pyq-btn { display: inline-block; background: linear-gradient(135deg, #d0ff45, #a3e635); color: #0f172a; font-weight: 800; font-size: 15px; text-decoration: none; padding: 14px 34px; border-radius: 999px; box-shadow: 0 4px 16px rgba(208, 255, 69, 0.35); }
    .meta-list { background: rgba(255,255,255,0.03); border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 13px; }
    .meta-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .meta-row:last-child { border-bottom: none; }
    .meta-label { color: #94a3b8; }
    .meta-val { color: #f1f5f9; font-weight: 600; }
    .footer { padding: 20px 28px; background-color: #090d16; border-top: 1px solid rgba(255,255,255,0.06); font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge-icon">🏆</span>
      <h1 class="brand-title">Topic Completed!</h1>
      <div class="brand-sub">StudyFlow Verified Mastery</div>
    </div>
    <div class="body-content">
      <div class="greeting">Congratulations, ${escapeHtml(name)}! 🎉</div>
      <p>Outstanding effort! You successfully demonstrated your conceptual understanding and passed the 10-question AI assessment for:</p>
      
      <div class="achievement-card">
        <div class="topic-pill">📚 ${escapeHtml(subjectName)}</div>
        <h2 style="color:#ffffff; font-size:18px; margin:8px 0 12px;">${escapeHtml(topicName)}</h2>
        <div class="score-badge">${score}/10</div>
        <div class="score-sub">${percentage}% Score (Pass threshold: 8/10)</div>
      </div>

      <div class="meta-list">
        <div class="meta-row">
          <span class="meta-label">Completion Date:</span>
          <span class="meta-val">${achievementDate}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Qualifying Attempt ID:</span>
          <span class="meta-val" style="font-family:monospace;">${qualifyingAttemptId}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Status:</span>
          <span class="meta-val" style="color:#34d399;">✓ Verified Complete</span>
        </div>
      </div>

      <p><strong>Next Step Recommended:</strong> Solidify your exam readiness by tackling relevant previous-year question papers for this topic.</p>

      <div class="btn-container">
        <a href="${practiceUrl}" target="_blank" class="pyq-btn">Practise Previous-Year Questions →</a>
      </div>
    </div>
    <div class="footer">
      <p>© 2026 StudyFlow — Plan Smarter. Study Better.<br>You are receiving this because achievement notifications are enabled in your StudyFlow account.</p>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Achievement unlocked! You completed ${topicName} on StudyFlow!

Congratulations ${name}!

You scored ${score}/10 (${percentage}%) on the verified 10-question assessment for:
Subject: ${subjectName}
Topic: ${topicName}
Date: ${achievementDate}

Next Step:
Now practise previous-year exam questions for this topic at:
${practiceUrl}

Best regards,
The StudyFlow Team
  `;

  const transporter = createTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log(`✓ Achievement email sent to: ${email} (MessageId: ${info.messageId})`);
      return { sent: true, provider: "smtp", messageId: info.messageId };
    } catch (err) {
      console.error(`✗ Failed to send achievement email via SMTP: ${err.message}`);
      return { sent: false, error: err.message, devLink: practiceUrl };
    }
  } else {
    console.log(`\n======================================================`);
    console.log(`[DEV MODE] Achievement email simulated for ${email}:`);
    console.log(`Subject: ${subject}`);
    console.log(`Score: ${score}/10 | Topic: ${topicName}`);
    console.log(`Practice URL: ${practiceUrl}`);
    console.log(`======================================================\n`);
    return { sent: false, devMode: true, devLink: practiceUrl, messageId: `dev_${Date.now()}` };
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  sendVerificationEmail,
  sendAchievementEmail,
};

