/**
 * assessment.js
 * StudyFlow v2.0 - Topic Assessment, Automatic Completion, Revision & PYQ Practice Engine
 */

const AssessmentManager = {
  currentTopicId: null,
  currentSubjectId: null,
  currentTopicName: '',
  currentSubjectName: '',
  currentQuiz: null,
  currentQuestionIndex: 0,
  selectedAnswers: {},
  startedAt: null,
  attemptResult: null,

  // ─── OPEN ASSESSMENT MODAL ────────────────────────────────
  async openModal(topicId, forceRegenerate = false) {
    if (!topicId) return;

    this.currentTopicId = topicId;
    this.selectedAnswers = {};
    this.currentQuestionIndex = 0;
    this.attemptResult = null;
    this.startedAt = new Date().toISOString();

    // Look up session and subject from local state
    const sessions = typeof getSess === 'function' ? getSess() : [];
    const subjects = typeof getSubs === 'function' ? getSubs() : [];

    const session = sessions.find(s => s.id === topicId || s.topicId === topicId || s.topic === topicId) || {};
    const subject = subjects.find(s => s.id === session.subjectId) || {};

    this.currentTopicName = session.topic || topicId;
    this.currentSubjectName = subject.name || 'Course Subject';
    this.currentSubjectId = subject.id || session.subjectId || '';

    // Update Modal Header
    const subBadge = document.getElementById('assessment-subject-badge');
    if (subBadge) subBadge.textContent = '📚 ' + this.currentSubjectName;

    const topTitle = document.getElementById('assessment-topic-title');
    if (topTitle) topTitle.textContent = this.currentTopicName;

    // Show Loading View
    this.switchView('loading');
    const loadingSub = document.getElementById('assessment-loading-sub');
    if (loadingSub) {
      loadingSub.textContent = 'Generating a calibrated 10-question multiple-choice assessment grounded in your syllabus and university past papers...';
    }

    if (typeof openModal === 'function') {
      openModal('assessment-modal');
    } else {
      const modal = document.getElementById('assessment-modal');
      if (modal) {
        modal.classList.add('open');
        const box = modal.querySelector('.modal-box');
        if (box) box.classList.add('open');
      }
    }

    try {
      const url = `/api/topics/${encodeURIComponent(topicId)}/assessment${forceRegenerate ? '?regenerate=true' : ''}`;
      const response = await AuthManager.fetchWithAuth(url, { method: 'GET' });
      const data = await response.json();

      if (!response.ok || !data.success || !data.data) {
        throw new Error(data.message || 'Could not load topic assessment.');
      }

      this.currentQuiz = data.data;
      if (!this.currentQuiz.questions || this.currentQuiz.questions.length !== 10) {
        throw new Error('Assessment must contain exactly 10 questions.');
      }

      // Switch to Quiz view
      this.switchView('quiz');
      this.renderQuestion(0);

    } catch (err) {
      console.error('Assessment load error:', err);
      const errMsgEl = document.getElementById('assessment-error-msg');
      if (errMsgEl) errMsgEl.textContent = err.message || 'Failed to connect to assessment service.';
      this.switchView('error');
    }
  },

  // ─── VIEW SWITCHER ────────────────────────────────────────
  switchView(viewName) {
    const views = {
      loading: document.getElementById('assessment-loading-view'),
      quiz: document.getElementById('assessment-quiz-view'),
      pass: document.getElementById('assessment-result-pass-view'),
      fail: document.getElementById('assessment-result-fail-view'),
      error: document.getElementById('assessment-error-view')
    };

    Object.values(views).forEach(v => {
      if (v) v.style.display = 'none';
    });

    if (views[viewName]) {
      views[viewName].style.display = viewName === 'quiz' ? 'flex' : 'block';
    }
  },

  // ─── RENDER QUESTION & STEPPER ────────────────────────────
  renderQuestion(index) {
    if (!this.currentQuiz || !this.currentQuiz.questions) return;
    const questions = this.currentQuiz.questions;
    if (index < 0 || index >= questions.length) return;

    this.currentQuestionIndex = index;
    const q = questions[index];

    // Counter & Progress Bar
    const currNumEl = document.getElementById('quiz-question-curr');
    if (currNumEl) currNumEl.textContent = (index + 1);

    const answeredCount = Object.keys(this.selectedAnswers).length;
    const countEl = document.getElementById('quiz-answered-count');
    if (countEl) countEl.textContent = `${answeredCount} of 10 answered`;

    // Dynamic Banner & Submit Button Text when answers are ready
    const readyBanner = document.getElementById('quiz-all-answered-banner');
    const submitBtn = document.getElementById('btn-quiz-submit');
    if (answeredCount === 10) {
      if (readyBanner) readyBanner.style.display = 'flex';
      if (submitBtn) {
        submitBtn.classList.add('ready-pulse');
        submitBtn.innerHTML = '<span>✓ Check Answers &amp; Submit (10/10) 🚀</span>';
      }
    } else {
      if (readyBanner) readyBanner.style.display = 'none';
      if (submitBtn) {
        submitBtn.classList.remove('ready-pulse');
        submitBtn.innerHTML = '<span>Check Answers &amp; Submit 🚀</span>';
      }
    }

    // Auto-scroll question area to top so question header is always visible
    const scrollArea = document.getElementById('quiz-scroll-area');
    if (scrollArea) scrollArea.scrollTop = 0;

    const progFill = document.getElementById('quiz-progress-fill');
    if (progFill) progFill.style.width = `${((index + 1) / 10) * 100}%`;

    // 10 Navigation Pills
    const pillsContainer = document.getElementById('quiz-nav-pills');
    if (pillsContainer) {
      pillsContainer.innerHTML = questions.map((item, idx) => {
        const isAnswered = this.selectedAnswers[item.id] !== undefined;
        const isActive = idx === index;
        let cls = 'quiz-pill-btn';
        if (isActive) cls += ' active';
        else if (isAnswered) cls += ' answered';

        return `<button type="button" class="${cls}" onclick="AssessmentManager.jumpToQuestion(${idx})" title="Question ${idx + 1} (${isAnswered ? 'Answered' : 'Unanswered'})">${idx + 1}</button>`;
      }).join('');
    }

    // Provenance & Difficulty Badges
    const provBadge = document.getElementById('quiz-q-prov');
    if (provBadge) {
      if (q.provenance === 'pyq') {
        provBadge.className = 'quiz-prov-badge';
        provBadge.textContent = '🎯 Exam PYQ Pattern' + (q.pyqReference ? ` (${q.pyqReference})` : '');
      } else {
        provBadge.className = 'quiz-prov-badge syllabus';
        provBadge.textContent = '📚 Syllabus Grounded';
      }
    }

    const diffBadge = document.getElementById('quiz-q-diff');
    if (diffBadge) {
      const colors = { easy: '#10b981', medium: '#fbbf24', hard: '#ef4444' };
      const diff = q.difficulty || 'medium';
      diffBadge.style.background = colors[diff] || '#fbbf24';
      diffBadge.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
    }

    // Question Text
    const qTextEl = document.getElementById('quiz-q-text');
    if (qTextEl) qTextEl.textContent = q.questionText;

    // 4 Options
    const optsContainer = document.getElementById('quiz-options-container');
    if (optsContainer) {
      const selectedOpt = this.selectedAnswers[q.id];
      optsContainer.innerHTML = q.options.map(opt => {
        const isSelected = selectedOpt === opt.id;
        return `
          <div class="quiz-option-card ${isSelected ? 'selected' : ''}" onclick="AssessmentManager.selectOption('${opt.id}')">
            <div class="quiz-opt-letter">${opt.id}</div>
            <div class="quiz-opt-text">${escapeHtml(opt.text)}</div>
          </div>
        `;
      }).join('');
    }

    // Nav Buttons
    const prevBtn = document.getElementById('btn-quiz-prev');
    if (prevBtn) prevBtn.disabled = index === 0;

    const nextBtn = document.getElementById('btn-quiz-next');
    if (nextBtn) {
      nextBtn.style.display = index === 9 ? 'none' : 'inline-block';
    }
  },

  jumpToQuestion(index) {
    this.renderQuestion(index);
  },

  prevQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.renderQuestion(this.currentQuestionIndex - 1);
    }
  },

  nextQuestion() {
    if (this.currentQuestionIndex < 9) {
      this.renderQuestion(this.currentQuestionIndex + 1);
    }
  },

  selectOption(optId) {
    if (!this.currentQuiz) return;
    const q = this.currentQuiz.questions[this.currentQuestionIndex];
    if (!q) return;

    this.selectedAnswers[q.id] = optId;
    this.renderQuestion(this.currentQuestionIndex);
  },

  // ─── SUBMISSION & CONFIRMATION ────────────────────────────
  confirmSubmit() {
    if (!this.currentQuiz) return;
    const answeredCount = Object.keys(this.selectedAnswers).length;

    if (answeredCount < 10) {
      const unanswered = 10 - answeredCount;
      const proceed = confirm(`⚠️ You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}.\n\nYou need at least 8 out of 10 correct answers to pass and complete this topic.\n\nDo you want to submit your assessment anyway?`);
      if (!proceed) return;
    }

    this.submitQuiz();
  },

  async submitQuiz() {
    this.switchView('loading');
    const loadingTitle = document.getElementById('assessment-loading-title');
    if (loadingTitle) loadingTitle.textContent = 'Calculating Result & Verifying Mastery...';
    const loadingSub = document.getElementById('assessment-loading-sub');
    if (loadingSub) loadingSub.textContent = 'Evaluating your answers against the answer key on the server...';

    try {
      const response = await AuthManager.fetchWithAuth(`/api/topics/${encodeURIComponent(this.currentTopicId)}/assessment/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId: this.currentQuiz.quizId,
          answers: this.selectedAnswers,
          startedAt: this.startedAt
        })
      });

      const resData = await response.json();
      if (!response.ok || !resData.success || !resData.data) {
        throw new Error(resData.message || 'Submission failed.');
      }

      this.attemptResult = resData.data;
      this.renderResult(this.attemptResult);

    } catch (err) {
      console.error('Submission error:', err);
      alert('Could not submit assessment: ' + (err.message || 'Network error'));
      this.switchView('quiz');
    }
  },

  // ─── RENDER RESULTS (PASS OR FAIL) ─────────────────────────
  renderResult(res) {
    const score = res.score;
    const percentage = res.percentage || Math.round((score / 10) * 100);
    const passed = res.passed;

    // Update local session status in memory to match authoritative backend
    const sessions = typeof getSess === 'function' ? getSess() : [];
    const targetSession = sessions.find(s => s.id === this.currentTopicId || s.topicId === this.currentTopicId || s.topic === this.currentTopicId);

    if (targetSession) {
      targetSession.status = passed ? 'done' : 'needs_revision';
      if (passed) {
        targetSession.completedScore = score;
        targetSession.completedAt = res.completedAt || new Date().toISOString();
      }
      if (typeof saveSess === 'function') {
        saveSess(sessions);
      }
      if (typeof window.syncSubjectProgressToSupabase === 'function' && targetSession.subjectId) {
        window.syncSubjectProgressToSupabase(targetSession.subjectId);
      }
    }

    if (passed) {
      // ─── PASSING RESULT (>= 8/10) ──────────────────────────
      this.switchView('pass');

      const scoreEl = document.getElementById('pass-score-display');
      if (scoreEl) scoreEl.textContent = `${score} / 10`;

      const pctEl = document.getElementById('pass-pct-display');
      if (pctEl) pctEl.textContent = `${percentage}% Conceptual Accuracy — Topic Completed ✓`;

      // Email notification status
      const emailStatusBox = document.getElementById('pass-email-status-box');
      const emailStatusText = document.getElementById('pass-email-status-text');
      if (emailStatusBox && emailStatusText) {
        const notif = res.notification || {};
        if (notif.status === 'sent') {
          emailStatusBox.style.display = 'flex';
          emailStatusBox.style.borderColor = 'rgba(16,185,129,0.35)';
          emailStatusText.innerHTML = `<strong>Achievement Unlocked!</strong> Congratulatory email sent to <strong>${escapeHtml(notif.details && notif.details.recipientEmail ? notif.details.recipientEmail : 'your email')}</strong> 🚀`;
        } else if (notif.status === 'dev_logged') {
          emailStatusBox.style.display = 'flex';
          emailStatusText.innerHTML = `<strong>Achievement Unlocked!</strong> Notification event logged in development mode. 📧`;
        } else if (notif.status === 'email_unverified') {
          emailStatusBox.style.display = 'flex';
          emailStatusText.innerHTML = `Verify your email address in account settings to receive official achievement notifications. 📧`;
        } else if (notif.status === 'notifications_disabled') {
          emailStatusBox.style.display = 'flex';
          emailStatusText.innerHTML = `Achievement emails are turned off in your notification preferences.`;
        } else {
          emailStatusBox.style.display = 'none';
        }
      }

      // Next Step: PYQ Practice (FR-09)
      const pyqListContainer = document.getElementById('pass-pyq-questions-list');
      if (pyqListContainer) {
        const pyqs = (res.pyqPractice && res.pyqPractice.questions) ? res.pyqPractice.questions : [];
        if (pyqs.length > 0) {
          pyqListContainer.innerHTML = pyqs.slice(0, 3).map(q => `
            <div class="pyq-practice-item">
              <div class="pyq-practice-meta">
                <span>📄 ${escapeHtml(q.paperName || 'Past Exam Paper')}</span>
                <span>${q.paperYear !== 'Unknown' ? 'Year ' + q.paperYear : ''} ${q.marks ? '· ' + q.marks + ' Marks' : ''}</span>
              </div>
              <div class="pyq-practice-text">${escapeHtml(q.questionText)}</div>
            </div>
          `).join('');
        } else {
          pyqListContainer.innerHTML = `
            <div style="font-size:.84rem; color:var(--muted); padding:.5rem 0;">
              ℹ️ No previous-year questions are currently uploaded for this subject. Upload past exam papers in the PYQ Analyzer to practice exam-pattern questions.
            </div>
          `;
        }
      }

      // Review Breakdown Accordion
      const passReviewList = document.getElementById('pass-review-list');
      if (passReviewList && res.questionBreakdown) {
        passReviewList.innerHTML = res.questionBreakdown.map((item, idx) => `
          <div class="review-question-item ${item.isCorrect ? 'correct' : 'incorrect'}">
            <div style="display:flex; justify-content:space-between; margin-bottom:.35rem; font-size:.78rem; font-weight:700;">
              <span style="color:#ffffff;">Q${idx + 1}. ${escapeHtml(item.questionText)}</span>
              <span style="color:${item.isCorrect ? '#34d399' : '#f87171'};">${item.isCorrect ? '✓ Correct (+1)' : '✗ Incorrect'}</span>
            </div>
            <div style="font-size:.82rem; color:var(--muted); margin-top:.25rem;">
              Your answer: <strong>${item.selectedOptionId || 'None'}</strong> | Correct answer: <strong>${item.correctOptionId}</strong>
            </div>
            <div class="review-explanation-box">
              💡 <strong>Explanation:</strong> ${escapeHtml(item.explanation)}
            </div>
          </div>
        `).join('');
      }

      // Activity & Toast for Passing Result (> 7 answers correct, i.e. 8, 9, 10)
      if (typeof addAct === 'function') {
        addAct(`Completed assessment for <strong>${this.currentTopicName}</strong> (${score}/10) — More than 7 correct! Topic Completed ✓ 🏆`);
      }
      if (typeof showToast === 'function') {
        showToast(`Topic Completed! Score: ${score}/10 (more than 7 correct) 🎉`, '🏆');
      }

    } else {
      // ─── FAILING RESULT (<= 7/10 - "You need revision") ─────
      this.switchView('fail');

      const failSubtitle = document.getElementById('fail-subtitle-msg');
      if (failSubtitle) {
        failSubtitle.textContent = `You answered ${score} of 10 answers correct (not more than 7). Please revise the concepts below and do the assessment again.`;
      }

      const failScoreEl = document.getElementById('fail-score-display');
      if (failScoreEl) failScoreEl.textContent = `${score} / 10`;

      const failPctEl = document.getElementById('fail-pct-display');
      if (failPctEl) failPctEl.textContent = `${percentage}% Score (Pass threshold requires > 7 correct, i.e. 8/10)`;

      const failRuleEl = document.getElementById('fail-rule-explanation');
      if (failRuleEl) {
        failRuleEl.textContent = `Not more than 7 answers were correct (${score}/10). Topic remains incomplete. Please revise and do the assessment again!`;
      }

      // Weak Concepts Tags
      const weakList = document.getElementById('fail-weak-concepts-list');
      if (weakList) {
        const concepts = res.weakConcepts || [this.currentTopicName];
        weakList.innerHTML = concepts.map(c => `
          <span class="weak-concept-tag">⚠️ Revise: ${escapeHtml(c)}</span>
        `).join('');
      }

      // Breakdown of Missed Questions & Explanations
      const failReviewList = document.getElementById('fail-review-list');
      if (failReviewList && res.questionBreakdown) {
        const missedQuestions = res.questionBreakdown.filter(q => !q.isCorrect);
        failReviewList.innerHTML = missedQuestions.map((item, idx) => `
          <div class="review-question-item incorrect">
            <div style="font-size:.86rem; font-weight:700; color:#ffffff; margin-bottom:.35rem;">
              ${escapeHtml(item.questionText)}
            </div>
            <div style="font-size:.8rem; color:#fca5a5; margin-bottom:.35rem;">
              Your selection: <strong>${item.selectedOptionId || 'Unanswered'}</strong> &nbsp;|&nbsp; Correct Choice: <strong style="color:#34d399;">${item.correctOptionId}</strong>
            </div>
            <div class="review-explanation-box" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:#fecaca;">
              💡 <strong>Key Concept Explanation:</strong> ${escapeHtml(item.explanation)}
            </div>
          </div>
        `).join('');
      }

      if (typeof addAct === 'function') {
        addAct(`Attempted assessment for <strong>${this.currentTopicName}</strong> (${score}/10) — Not more than 7 answers correct. Please revise and do the assessment again! ⚠️`);
      }
      if (typeof showToast === 'function') {
        showToast(`Score: ${score}/10 (not more than 7 correct). Please revise and do the assessment again! ⚠️`, '⚠️');
      }
    }

    if (typeof renderAll === 'function') {
      renderAll();
    }
  },

  // ─── ACTION BUTTONS ───────────────────────────────────────
  async markPYQPracticed() {
    if (!this.currentTopicId) return;
    try {
      const res = await AuthManager.fetchWithAuth(`/api/topics/${encodeURIComponent(this.currentTopicId)}/pyqs/practice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const btn = document.getElementById('btn-mark-pyq-practiced');
        if (btn) {
          btn.textContent = '✓ Practiced & Mastered';
          btn.style.background = 'rgba(16,185,129,0.2)';
        }
        if (typeof showToast === 'function') {
          showToast('PYQ practice status updated to Completed! 🎯', '✓');
        }
      }
    } catch (e) {
      console.warn('PYQ practice error:', e);
    }
  },

  retakeAssessment() {
    this.openModal(this.currentTopicId, true);
  },

  openNotesForTopic() {
    this.closeModal();
    // Switch to Study Notes tab
    const notesTab = document.querySelector('.sidebar-nav .nav-item[data-tab="notes"]');
    if (notesTab) notesTab.click();

    const notesArea = document.getElementById('full-notes-area');
    if (notesArea && !notesArea.value.includes(this.currentTopicName)) {
      notesArea.value = `\n\n### 📝 Revision Notes: ${this.currentTopicName}\n- Key Concept 1:\n- Formula / Theorem:\n- Common Exam Pitfall:\n` + notesArea.value;
      if (typeof saveNotes === 'function') saveNotes(notesArea.value);
    }
    if (typeof showToast === 'function') {
      showToast(`Ready for revision: ${this.currentTopicName} 📖`, '📝');
    }
  },

  retryLoad() {
    this.openModal(this.currentTopicId, true);
  },

  closeModal() {
    if (typeof closeModal === 'function') {
      closeModal('assessment-modal');
    } else {
      const modal = document.getElementById('assessment-modal');
      if (modal) {
        modal.classList.remove('open');
        const box = modal.querySelector('.modal-box');
        if (box) box.classList.remove('open');
      }
    }
  },

  closeModalAndRefresh() {
    this.closeModal();
    if (typeof renderAll === 'function') {
      renderAll();
    }
  }
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.AssessmentManager = AssessmentManager;
