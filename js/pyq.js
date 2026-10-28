/**
 * pyq.js
 * 
 * Client-side Controller & UI manager for Previous-Year Question Paper Analyzer
 * Handles multi-file uploads, evidence-based prioritization, year charts, question bank review,
 * inline classification corrections, and study plan generation.
 */

const PYQManager = {
  activeSubjectId: null,
  activeAnalysis: null,
  uploadedFilesList: [], // { file, year, id }
  pyqHistory: [],
  activeSubTab: 'priorities',
  filterYear: 'all',
  filterUnit: 'all',
  filterPriority: 'all',
  filterMarks: 'all',
  searchKeyword: '',

  // Initialize PYQ Tab
  async init() {
    console.log("Initializing Previous-Year Question Paper Analyzer...");
    await this.loadSubjectsAndHistory();
    this.setupEventListeners();
  },

  // Load user subjects and past PYQ analyses
  async loadSubjectsAndHistory() {
    try {
      const historyRes = await fetch('/api/pyq/history', { credentials: 'include' });
      const historyData = await historyRes.json();
      if (historyData.success) {
        this.pyqHistory = historyData.data || [];
        this.updateBadgeCount(this.pyqHistory.length);
      }
    } catch (e) {
      console.warn("Could not load PYQ history:", e);
    }

    this.populateSubjectDropdown();

    // Auto-select latest analysis or first available
    if (this.pyqHistory.length > 0) {
      const latest = this.pyqHistory[0];
      this.selectSubjectAnalysis(latest.subjectId);
    } else {
      this.renderEmptyState();
    }
  },

  updateBadgeCount(count) {
    const badge = document.getElementById('badge-pyq');
    if (badge) {
      badge.textContent = count > 0 ? `${count} Analyzed` : 'New';
    }
  },

  populateSubjectDropdown() {
    const dropdown = document.getElementById('pyq-subject-selector');
    if (!dropdown) return;

    const subjects = window.getSubs ? window.getSubs() : [];
    
    // Merge subjects from dashboard with any analyzed subjects
    const allOptionsMap = new Map();
    subjects.forEach(s => {
      const hasSyl = Array.isArray(s.units) && s.units.length > 0;
      allOptionsMap.set(s.id, { id: s.id, name: s.name, hasSyllabus: hasSyl, unitsCount: hasSyl ? s.units.length : 0, hasAnalysis: false });
    });

    this.pyqHistory.forEach(h => {
      const existing = allOptionsMap.get(h.subjectId);
      if (existing) {
        existing.hasAnalysis = true;
      } else {
        allOptionsMap.set(h.subjectId, { id: h.subjectId, name: h.subjectName, hasSyllabus: true, unitsCount: 0, hasAnalysis: true });
      }
    });

    let optionsHtml = '<option value="">-- Choose Course / Subject --</option>';
    for (const [id, item] of allOptionsMap.entries()) {
      let badge = '';
      if (item.hasAnalysis) {
        badge = ' (✨ Analyzed)';
      } else if (item.hasSyllabus) {
        badge = ` (📘 ${item.unitsCount} Units Syllabus)`;
      } else {
        badge = ' (⚠️ No Syllabus Uploaded)';
      }
      optionsHtml += `<option value="${id}">${this.escapeHtml(item.name)}${badge}</option>`;
    }
    dropdown.innerHTML = optionsHtml;

    if (this.activeSubjectId) {
      dropdown.value = this.activeSubjectId;
    }
  },

  async selectSubjectAnalysis(subjectId) {
    if (!subjectId) {
      this.activeSubjectId = null;
      this.activeAnalysis = null;
      this.renderEmptyState();
      return;
    }

    this.activeSubjectId = subjectId;
    const dropdown = document.getElementById('pyq-subject-selector');
    if (dropdown) dropdown.value = subjectId;

    // Show loading skeleton
    const container = document.getElementById('pyq-main-content');
    if (container) {
      container.innerHTML = `<div class="empty-pane"><div class="ai-spinner"></div><h3>Loading Question Paper Analysis...</h3></div>`;
    }

    try {
      const res = await fetch(`/api/pyq/subject/${encodeURIComponent(subjectId)}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data) {
        this.activeAnalysis = data.data;
        this.renderActiveAnalysis();
      } else {
        this.renderNotAnalyzedState(subjectId);
      }
    } catch (e) {
      console.error("Failed to load subject PYQ analysis:", e);
      this.renderNotAnalyzedState(subjectId);
    }
  },

  renderEmptyState() {
    const container = document.getElementById('pyq-main-content');
    if (!container) return;

    const subjects = window.getSubs ? window.getSubs() : [];
    const subjectsWithSyllabus = subjects.filter(s => Array.isArray(s.units) && s.units.length > 0);

    if (!subjectsWithSyllabus.length) {
      // User has not uploaded any syllabus yet
      container.innerHTML = `
        <div class="empty-pane" style="padding:4rem 2rem;text-align:center;">
          <div class="empty-icon" style="font-size:3.5rem;margin-bottom:1rem;">📘</div>
          <h3 style="font-size:1.4rem;font-weight:800;color:#ffffff;margin-bottom:.5rem;">Upload Your Course Syllabus First</h3>
          <p style="font-size:.92rem;color:var(--text-secondary);max-width:580px;margin:0 auto 1.6rem;line-height:1.6;">
            To identify high-yield topics and calculate accurate syllabus coverage, StudyFlow requires your official course syllabus (e.g. <strong>Maths 4</strong>). Every question from past exam papers will then be matched directly to your specific syllabus units.
          </p>
          <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;">
            <button class="btn-pyq-primary" onclick="window.openUploadModal ? window.openUploadModal() : openUploadModal()" style="margin:0;background:linear-gradient(135deg, #4f46e5, #7c3aed);">
              <span>📤</span> Step 1: Upload Course Syllabus
            </button>
          </div>
        </div>
      `;
    } else {
      // User has subjects with syllabus
      container.innerHTML = `
        <div class="empty-pane" style="padding:4rem 2rem;text-align:center;">
          <div class="empty-icon" style="font-size:3.5rem;margin-bottom:1rem;">📑</div>
          <h3 style="font-size:1.35rem;font-weight:800;color:#ffffff;margin-bottom:.5rem;">Previous-Year Question Paper Analyzer</h3>
          <p style="font-size:.9rem;color:var(--text-secondary);max-width:560px;margin:0 auto 1.75rem;line-height:1.6;">
            You have <strong>${subjectsWithSyllabus.length} enrolled course(s) with syllabus</strong>. Upload your past exam papers (PDFs) to extract questions, discover recurring high-yield topics, and detect syllabus gaps.
          </p>
          <button class="btn-pyq-primary" onclick="PYQManager.openUploadModal()" style="margin:0 auto;">
            <span>✨</span> Upload &amp; Analyze Question Papers
          </button>
        </div>
      `;
    }
  },

  renderNotAnalyzedState(subjectId) {
    const container = document.getElementById('pyq-main-content');
    if (!container) return;

    const subjects = window.getSubs ? window.getSubs() : [];
    const sub = subjects.find(s => s.id === subjectId);
    const subName = sub ? sub.name : 'Selected Subject';
    const hasSyllabus = sub && Array.isArray(sub.units) && sub.units.length > 0;

    if (hasSyllabus) {
      const unitsCount = sub.units.length;
      let topicsCount = 0;
      sub.units.forEach(u => topicsCount += (u.topics || []).length);

      container.innerHTML = `
        <div class="empty-pane" style="padding:3.5rem 2rem;text-align:center;">
          <div class="empty-icon" style="font-size:3rem;margin-bottom:.75rem;">📚</div>
          <h3 style="font-size:1.3rem;font-weight:800;color:#ffffff;margin-bottom:.4rem;">Ready to Analyze Papers for "${this.escapeHtml(subName)}"</h3>
          <div style="display:inline-flex;align-items:center;gap:.5rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);border-radius:20px;padding:.35rem .9rem;font-size:.82rem;color:#34d399;font-weight:600;margin-bottom:1.2rem;">
            ✓ Official Syllabus Attached (${unitsCount} Units, ${topicsCount} Topics)
          </div>
          <p style="font-size:.88rem;color:var(--text-secondary);max-width:520px;margin:0 auto 1.5rem;line-height:1.5;">
            Upload 1 to 5 previous-year question papers. StudyFlow will match every question directly against the ${topicsCount} topics in your ${this.escapeHtml(subName)} syllabus.
          </p>
          <button class="btn-pyq-primary" onclick="PYQManager.openUploadModal('${subjectId}')" style="margin:0 auto;">
            <span>📑</span> Upload Papers for ${this.escapeHtml(subName)}
          </button>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-pane" style="padding:3.5rem 2rem;text-align:center;">
          <div class="empty-icon" style="font-size:3rem;margin-bottom:.75rem;">⚠️</div>
          <h3 style="font-size:1.3rem;font-weight:800;color:#ffffff;margin-bottom:.4rem;">Syllabus Required for "${this.escapeHtml(subName)}"</h3>
          <p style="font-size:.88rem;color:var(--text-secondary);max-width:520px;margin:0 auto 1.5rem;line-height:1.5;">
            Before analyzing previous-year question papers for <strong>${this.escapeHtml(subName)}</strong>, please upload its course syllabus. This ensures questions are accurately mapped to your curriculum.
          </p>
          <button class="btn-pyq-primary" onclick="window.openUploadModal ? window.openUploadModal() : openUploadModal()" style="margin:0 auto;background:linear-gradient(135deg, #f59e0b, #d97706);color:#000;">
            <span>📤</span> Upload Syllabus for ${this.escapeHtml(subName)}
          </button>
        </div>
      `;
    }
  },

  renderActiveAnalysis() {
    const a = this.activeAnalysis;
    if (!a) return;

    const container = document.getElementById('pyq-main-content');
    if (!container) return;

    const papersCount = (a.papers || []).length;
    const questionsCount = (a.questions || []).length;
    const highYieldCount = (a.topicPriorities || []).filter(t => t.priorityLevel === 'High').length;
    const coveragePct = (a.syllabusCoverage && a.syllabusCoverage.coveragePercentage !== undefined) ? a.syllabusCoverage.coveragePercentage : 100;
    const uncoveredCount = a.syllabusCoverage ? (a.syllabusCoverage.uncoveredTopicsCount || 0) : 0;

    const yearsList = (a.papers || []).map(p => p.year).filter(Boolean);
    const yearSpan = yearsList.length > 0 ? yearsList.join(', ') : 'Uploaded Papers';

    let html = `
      <!-- TOP STATS SUMMARY -->
      <div class="pyq-stats-row">
        <div class="pyq-stat-card">
          <div class="p-label">Analyzed Papers</div>
          <div class="p-val" style="color:#a78bfa;">${papersCount}</div>
          <div class="p-sub">Years: ${this.escapeHtml(yearSpan)}</div>
        </div>
        <div class="pyq-stat-card">
          <div class="p-label">Total Questions</div>
          <div class="p-val" style="color:#38bdf8;">${questionsCount}</div>
          <div class="p-sub">Extracted &amp; Classified</div>
        </div>
        <div class="pyq-stat-card">
          <div class="p-label">High-Yield Topics</div>
          <div class="p-val" style="color:#f87171;">${highYieldCount}</div>
          <div class="p-sub">Frequent recurring exam focus</div>
        </div>
        <div class="pyq-stat-card">
          <div class="p-label">Syllabus Coverage</div>
          <div class="p-val" style="color:#34d399;">${coveragePct}%</div>
          <div class="p-sub">${uncoveredCount} topics never examined</div>
        </div>
      </div>

      <!-- OFFICIAL SYLLABUS LINKAGE BANNER -->
      <div style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.35);border-radius:12px;padding:.85rem 1.25rem;margin-bottom:1.3rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;">
        <div style="display:flex;align-items:center;gap:.65rem;">
          <span style="font-size:1.35rem;">📘</span>
          <div>
            <div style="font-size:.88rem;font-weight:700;color:#e0e7ff;">Matched Against Official Syllabus: ${this.escapeHtml(a.subjectName)}</div>
            <div style="font-size:.78rem;color:#a5b4fc;">
              ${a.syllabusCoverage?.totalSyllabusTopics || (a.topicPriorities || []).length} Curriculum Topics • ${coveragePct}% Examined in PYQs
            </div>
          </div>
        </div>
        <div style="font-size:.8rem;color:#34d399;font-weight:600;display:flex;align-items:center;gap:.4rem;">
          <span>✓</span> ${questionsCount} PYQ questions mapped to syllabus
        </div>
      </div>

      <!-- ADVISORY BANNER IF SINGLE PAPER -->
      ${papersCount === 1 ? `
        <div style="background:rgba(245, 158, 11, 0.12);border:1px solid rgba(245, 158, 11, 0.35);border-radius:12px;padding:.85rem 1.25rem;margin-bottom:1.4rem;display:flex;align-items:center;gap:.75rem;">
          <span style="font-size:1.25rem;">⚠️</span>
          <div style="font-size:.84rem;color:#fde68a;">
            <strong>Single Paper Advisory:</strong> You have uploaded 1 question paper (${a.papers[0]?.year || 'Current'}). Multi-year historical recurrence cannot be established reliably until papers from multiple exam years are uploaded.
          </div>
        </div>
      ` : ''}

      <!-- SUB-TABS NAVIGATION -->
      <div class="pyq-subnav">
        <button class="pyq-subnav-btn ${this.activeSubTab === 'priorities' ? 'active' : ''}" onclick="PYQManager.switchSubTab('priorities')">
          <span>🎯</span> Topic Priority List (${(a.topicPriorities || []).length})
        </button>
        <button class="pyq-subnav-btn ${this.activeSubTab === 'frequent' ? 'active' : ''}" onclick="PYQManager.switchSubTab('frequent')">
          <span>📊</span> Frequency &amp; Scoring
        </button>
        <button class="pyq-subnav-btn ${this.activeSubTab === 'years' ? 'active' : ''}" onclick="PYQManager.switchSubTab('years')">
          <span>📅</span> Year-Wise Trends
        </button>
        <button class="pyq-subnav-btn ${this.activeSubTab === 'qbank' ? 'active' : ''}" onclick="PYQManager.switchSubTab('qbank')">
          <span>📝</span> Question Bank (${questionsCount})
        </button>
        <button class="pyq-subnav-btn ${this.activeSubTab === 'coverage' ? 'active' : ''}" onclick="PYQManager.switchSubTab('coverage')">
          <span>📚</span> Syllabus Coverage Gap
        </button>
      </div>

      <!-- TAB 1: TOPIC PRIORITY LIST -->
      <div id="pyq-view-priorities" style="display:${this.activeSubTab === 'priorities' ? 'block' : 'none'};">
        ${this.renderPriorityList(a.topicPriorities || [])}
      </div>

      <!-- TAB 2: FREQUENT TOPICS & RANKING -->
      <div id="pyq-view-frequent" style="display:${this.activeSubTab === 'frequent' ? 'block' : 'none'};">
        ${this.renderFrequentTopics(a.topicPriorities || [])}
      </div>

      <!-- TAB 3: YEAR-WISE ANALYSIS -->
      <div id="pyq-view-years" style="display:${this.activeSubTab === 'years' ? 'block' : 'none'};">
        ${this.renderYearWiseAnalysis(a)}
      </div>

      <!-- TAB 4: QUESTION BANK WITH USER CORRECTIONS -->
      <div id="pyq-view-qbank" style="display:${this.activeSubTab === 'qbank' ? 'block' : 'none'};">
        ${this.renderQuestionBank(a.questions || [])}
      </div>

      <!-- TAB 5: SYLLABUS COVERAGE -->
      <div id="pyq-view-coverage" style="display:${this.activeSubTab === 'coverage' ? 'block' : 'none'};">
        ${this.renderSyllabusCoverage(a.syllabusCoverage, a.topicPriorities)}
      </div>
    `;

    container.innerHTML = html;
  },

  switchSubTab(tabName) {
    this.activeSubTab = tabName;
    document.querySelectorAll('.pyq-subnav-btn').forEach(btn => btn.classList.remove('active'));
    
    ['priorities', 'frequent', 'years', 'qbank', 'coverage'].forEach(name => {
      const el = document.getElementById(`pyq-view-${name}`);
      if (el) el.style.display = (name === tabName) ? 'block' : 'none';
    });

    const activeBtn = Array.from(document.querySelectorAll('.pyq-subnav-btn')).find(b => b.textContent.toLowerCase().includes(tabName.slice(0, 4)));
    if (activeBtn) activeBtn.classList.add('active');
  },

  // ─── SECTION A: TOPIC PRIORITY LIST ─────────────────────────
  renderPriorityList(topics = []) {
    if (!topics.length) {
      return `<div class="empty-pane"><p>No topics extracted yet.</p></div>`;
    }

    const cardsHtml = topics.map(t => {
      const isHigh = t.priorityLevel === 'High';
      const isMed = t.priorityLevel === 'Medium';
      const borderClass = isHigh ? 'high-priority-border' : (isMed ? 'medium-priority-border' : 'low-priority-border');
      const pillClass = isHigh ? 'p-pill-high' : (isMed ? 'p-pill-medium' : 'p-pill-low');

      const yearsBadge = (t.yearsAppeared && t.yearsAppeared.length) ? t.yearsAppeared.join(', ') : 'Single Paper';
      const marksText = t.totalMarks > 0 ? `${t.totalMarks} Marks` : 'Unspecified Marks';

      return `
        <div class="pyq-topic-item ${borderClass}">
          <div class="pyq-topic-head">
            <div>
              <div class="pyq-topic-title">${this.escapeHtml(t.topicName)}</div>
              <div class="pyq-topic-unit">📖 ${this.escapeHtml(t.unit || 'General Syllabus Unit')}</div>
            </div>
            <div class="pyq-topic-score-badge">
              <span class="p-pill ${pillClass}">● ${t.priorityLevel} Priority</span>
              <span class="pyq-score-num" title="Composite Score: ${t.priorityScore}/100">${t.priorityScore} / 100</span>
            </div>
          </div>

          <div class="pyq-metrics-row">
            <div class="pyq-metric">
              <span class="pyq-metric-label">Paper Presence</span>
              <span class="pyq-metric-value" style="color:#a78bfa;">${t.paperCount} / ${t.totalPaperCount} (${t.paperFrequencyPercent}%)</span>
            </div>
            <div class="pyq-metric">
              <span class="pyq-metric-label">Question Count</span>
              <span class="pyq-metric-value">${t.questionCount} question${t.questionCount > 1 ? 's' : ''}</span>
            </div>
            <div class="pyq-metric">
              <span class="pyq-metric-label">Exam Years</span>
              <span class="pyq-metric-value">${this.escapeHtml(yearsBadge)}</span>
            </div>
            <div class="pyq-metric">
              <span class="pyq-metric-label">Total Marks</span>
              <span class="pyq-metric-value" style="color:#fbbf24;">${marksText}</span>
            </div>
            ${t.hasLongAnswer ? `
              <div class="pyq-metric">
                <span class="pyq-metric-label">Question Type</span>
                <span class="pyq-metric-value" style="color:#f87171;">⭐ Long Answer (High Marks)</span>
              </div>
            ` : ''}
            ${t.isExplicitSyllabusTopic ? `
              <div class="pyq-metric">
                <span class="pyq-metric-label">Syllabus Match</span>
                <span class="pyq-metric-value" style="color:#34d399;">✓ Explicit Syllabus Topic</span>
              </div>
            ` : ''}
          </div>

          <div class="pyq-explanation">
            <strong>Evidence &amp; Rationale:</strong> ${this.escapeHtml(t.explanation)}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;flex-wrap:wrap;gap:.75rem;">
        <div>
          <h3 style="font-size:1.15rem;font-weight:700;color:#ffffff;">Evidence-Based Study Priorities</h3>
          <p style="font-size:.82rem;color:var(--muted);">Topics ranked objectively across all accumulated exam years (${this.activeAnalysis?.papers?.map(p => p.year).filter(Boolean).join(', ') || 'Uploaded Papers'}).</p>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
          <button class="btn-pyq-primary" onclick="PYQManager.openUploadModal('${this.activeSubjectId}')" style="padding:.5rem 1rem;font-size:.82rem;margin:0;">
            <span>➕</span> Add Another Year's Paper
          </button>
          <button class="btn-pyq-plan" onclick="PYQManager.openStudyPlanModal()" style="margin:0;">
            <span>📅</span> Create Study Plan
          </button>
        </div>
      </div>
      <div class="pyq-topics-grid">${cardsHtml}</div>
    `;
  },

  // ─── SECTION B: FREQUENTLY ASKED TOPICS & ALGORITHM ─────────
  renderFrequentTopics(topics = []) {
    const totalPapers = this.activeAnalysis?.papers?.length || 1;

    return `
      <div class="pyq-chart-box" style="margin-bottom:1.5rem;">
        <div class="pyq-chart-title">
          <span>⚖️ Transparent Scoring Algorithm Formula</span>
          <span style="font-size:.78rem;color:var(--muted);font-weight:400;">Configurable Mathematical Weights</span>
        </div>
        <div style="font-size:.85rem;color:var(--text-secondary);line-height:1.6;background:rgba(255, 255, 255, 0.03);padding:1rem 1.25rem;border-radius:10px;border:1px solid var(--border);">
          <div><strong>Final Topic Priority Score (0 - 100)</strong> = </div>
          <div style="margin-top:.4rem;font-family:monospace;color:#c084fc;font-size:.88rem;">
            (Frequency Across Papers × 35%) + (Multi-Year Recurrence × 25%) + (Normalized Marks × 20%) + (Log-Damped Question Count × 10%) + (Syllabus Bonus × 5%) + (Weak Topic Boost × 5%)
          </div>
          <div style="margin-top:.6rem;font-size:.78rem;color:var(--muted);">
            • Distinct paper occurrences are counted separately from raw question count to avoid 1 anomalous paper with multiple minor sub-questions skewing the score.<br>
            • Unknown marks are excluded from negative bias. Single paper analysis scales recurrence honestly without false historical claims.
          </div>
        </div>
      </div>

      <div class="pyq-chart-box">
        <div class="pyq-chart-title">
          <span>📊 Topic Frequency &amp; Weight Ranking</span>
          <span style="font-size:.82rem;color:var(--muted);">${topics.length} Analyzed Topics</span>
        </div>
        <div class="pyq-year-bars">
          ${topics.map(t => {
            const pct = t.paperFrequencyPercent || 0;
            const barColor = t.priorityLevel === 'High' ? 'linear-gradient(90deg, #ef4444, #f59e0b)' : (t.priorityLevel === 'Medium' ? 'linear-gradient(90deg, #f59e0b, #38bdf8)' : 'linear-gradient(90deg, #34d399, #64748b)');
            return `
              <div class="pyq-bar-row">
                <span class="pyq-bar-label" title="${this.escapeHtml(t.topicName)}">${this.escapeHtml(t.topicName)}</span>
                <div class="pyq-bar-track">
                  <div class="pyq-bar-fill" style="width:${Math.max(5, pct)}%;background:${barColor};"></div>
                </div>
                <span class="pyq-bar-cnt">${t.paperCount}/${totalPapers} (${pct}%)</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  // ─── SECTION C: YEAR-WISE ANALYSIS ──────────────────────────
  renderYearWiseAnalysis(analysis) {
    const papers = analysis.papers || [];
    const questions = analysis.questions || [];

    if (!papers.length) {
      return `<div class="empty-pane"><p>No papers available for year-wise breakdown.</p></div>`;
    }

    // Group questions by year and topic
    const years = [...new Set(papers.map(p => p.year))].sort();

    return `
      <div style="background:rgba(139, 92, 246, 0.12);border:1px solid rgba(139, 92, 246, 0.35);border-radius:14px;padding:1.1rem 1.4rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span style="font-size:1.6rem;">📈</span>
          <div>
            <h4 style="font-size:1rem;font-weight:700;color:#ffffff;margin-bottom:.2rem;">Multi-Year Recurrence Evidence (${papers.length} Papers Accumulated)</h4>
            <p style="font-size:.82rem;color:var(--text-secondary);line-height:1.45;">
              Topic priority scores increase when questions repeat across multiple exam years (${years.join(', ')}). Uploading more past papers sharpens the prediction of your upcoming exam.
            </p>
          </div>
        </div>
        <button class="btn-pyq-primary" onclick="PYQManager.openUploadModal('${this.activeSubjectId}')" style="padding:.45rem .95rem;font-size:.82rem;margin:0;">
          <span>➕</span> Upload Another Year
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:1.25rem;">
        ${papers.map(paper => {
          const yr = paper.year || 'Unknown';
          const yrQuestions = questions.filter(q => (q.paperId ? q.paperId === paper.id : String(q.paperYear) === String(yr)));
          
          // Unique topics in this year
          const yrTopicsMap = new Map();
          yrQuestions.forEach(q => {
            const t = q.matchedTopic || 'General Topic';
            yrTopicsMap.set(t, (yrTopicsMap.get(t) || 0) + 1);
          });

          return `
            <div class="pyq-chart-box" style="margin-bottom:0;position:relative;">
              <div class="pyq-chart-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:800;color:#ffffff;">📅 Year ${this.escapeHtml(yr)} Examination</span>
                <span class="pyq-tag pyq-tag-year">${yrQuestions.length} Questions</span>
              </div>
              <div style="font-size:.78rem;color:var(--muted);margin-bottom:.85rem;display:flex;justify-content:space-between;align-items:center;">
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;" title="${this.escapeHtml(paper.fileName)}">
                  Source: <strong>${this.escapeHtml(paper.fileName || 'Question Paper PDF')}</strong>
                </span>
                <button type="button" onclick="PYQManager.deletePaper('${paper.id}', '${yr}')" style="background:none;border:none;color:#f87171;font-size:.76rem;cursor:pointer;padding:.2rem .4rem;border-radius:4px;" title="Remove this year's paper">
                  🗑️ Remove
                </button>
              </div>
              <div style="display:flex;flex-direction:column;gap:.6rem;">
                ${Array.from(yrTopicsMap.entries()).map(([top, count]) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .65rem;background:rgba(255, 255, 255, 0.03);border-radius:8px;border:1px solid rgba(255, 255, 255, 0.05);font-size:.84rem;">
                    <span style="color:#ffffff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${this.escapeHtml(top)}</span>
                    <span style="color:var(--accent2);font-weight:700;">${count} Qs</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // ─── SECTION D: QUESTION BANK & USER EDIT MODAL ─────────────
  renderQuestionBank(questions = []) {
    if (!questions.length) {
      return `<div class="empty-pane"><p>No questions extracted.</p></div>`;
    }

    const filterYears = [...new Set(questions.map(q => q.paperYear).filter(Boolean))];
    const filterUnits = [...new Set(questions.map(q => q.detectedUnit).filter(Boolean))];

    // Filter questions
    let filtered = [...questions];
    if (this.filterYear !== 'all') {
      filtered = filtered.filter(q => String(q.paperYear) === String(this.filterYear));
    }
    if (this.filterUnit !== 'all') {
      filtered = filtered.filter(q => q.detectedUnit === this.filterUnit);
    }
    if (this.filterMarks === 'long') {
      filtered = filtered.filter(q => q.marks >= 7);
    } else if (this.filterMarks === 'short') {
      filtered = filtered.filter(q => q.marks && q.marks < 7);
    }
    if (this.searchKeyword) {
      const kw = this.searchKeyword.toLowerCase();
      filtered = filtered.filter(q => 
        (q.questionText && q.questionText.toLowerCase().includes(kw)) ||
        (q.matchedTopic && q.matchedTopic.toLowerCase().includes(kw)) ||
        (q.detectedUnit && q.detectedUnit.toLowerCase().includes(kw))
      );
    }

    const cardsHtml = filtered.map(q => {
      const marksBadge = (typeof q.marks === 'number') ? `${q.marks} Marks` : 'Marks Unstated';
      const isExplicit = q.isExplicitSyllabusMatch;
      const isCorrected = q.isUserCorrected;

      return `
        <div class="pyq-q-card">
          <div class="pyq-q-top">
            <div class="pyq-q-tags">
              <span class="pyq-tag pyq-tag-year">📅 ${this.escapeHtml(q.paperYear || 'Unknown')} • ${this.escapeHtml(q.questionNumber || 'Q')}</span>
              <span class="pyq-tag pyq-tag-marks">⚖️ ${marksBadge}</span>
              <span class="pyq-tag pyq-tag-topic">🎯 ${this.escapeHtml(q.matchedTopic)}</span>
              ${isExplicit ? `<span class="pyq-tag pyq-tag-explicit">✓ Syllabus Topic</span>` : `<span class="pyq-tag">AI Inferred</span>`}
              ${isCorrected ? `<span class="pyq-tag" style="background:rgba(208, 255, 69, 0.15);color:var(--lime);">✏️ User Reviewed</span>` : ''}
            </div>
            <button class="btn-reclassify" onclick="PYQManager.openReclassifyModal('${q.id}')">
              ✏️ Edit Classification
            </button>
          </div>

          <div class="pyq-q-text">
            ${this.escapeHtml(q.questionText)}
          </div>

          <div class="pyq-q-footer">
            <span>Unit: <strong>${this.escapeHtml(q.detectedUnit || 'General')}</strong></span>
            <span>Confidence: <strong style="text-transform:capitalize;color:${q.confidence === 'high' ? '#34d399' : '#fbbf24'};">${q.confidence || 'medium'}</strong></span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="pyq-qbank-filters">
        <div class="table-search-box" style="flex:1;min-width:240px;">
          <span>🔍</span>
          <input type="text" id="pyq-search-input" value="${this.escapeHtml(this.searchKeyword)}" placeholder="Search questions, topics, or formulas..." oninput="PYQManager.handleSearch(this.value)">
        </div>

        <select class="pyq-select-dropdown" onchange="PYQManager.handleFilterYear(this.value)">
          <option value="all" ${this.filterYear === 'all' ? 'selected' : ''}>All Years</option>
          ${filterYears.map(y => `<option value="${y}" ${this.filterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
        </select>

        <select class="pyq-select-dropdown" onchange="PYQManager.handleFilterUnit(this.value)">
          <option value="all" ${this.filterUnit === 'all' ? 'selected' : ''}>All Units</option>
          ${filterUnits.map(u => `<option value="${u}" ${this.filterUnit === u ? 'selected' : ''}>${this.escapeHtml(u)}</option>`).join('')}
        </select>

        <select class="pyq-select-dropdown" onchange="PYQManager.handleFilterMarks(this.value)">
          <option value="all" ${this.filterMarks === 'all' ? 'selected' : ''}>All Question Marks</option>
          <option value="long" ${this.filterMarks === 'long' ? 'selected' : ''}>Long Answer (≥ 7 Marks)</option>
          <option value="short" ${this.filterMarks === 'short' ? 'selected' : ''}>Short / Medium (&lt; 7 Marks)</option>
        </select>
      </div>

      <div style="font-size:.82rem;color:var(--muted);margin-bottom:.85rem;">
        Showing ${filtered.length} of ${questions.length} extracted questions
      </div>

      <div>${filtered.length > 0 ? cardsHtml : '<div class="empty-pane"><p>No questions matched the filter.</p></div>'}</div>
    `;
  },

  handleSearch(kw) {
    this.searchKeyword = kw;
    this.renderActiveAnalysis();
  },
  handleFilterYear(y) {
    this.filterYear = y;
    this.renderActiveAnalysis();
  },
  handleFilterUnit(u) {
    this.filterUnit = u;
    this.renderActiveAnalysis();
  },
  handleFilterMarks(m) {
    this.filterMarks = m;
    this.renderActiveAnalysis();
  },

  // ─── SECTION E: SYLLABUS COVERAGE & GAP ANALYSIS ────────────
  renderSyllabusCoverage(coverage, priorities = []) {
    if (!coverage) {
      return `<div class="empty-pane"><p>Syllabus coverage data not calculated.</p></div>`;
    }

    const covered = coverage.coveredTopics || [];
    const uncovered = coverage.uncoveredTopics || [];

    return `
      <div style="background:rgba(139, 92, 246, 0.12);border:1px solid rgba(139, 92, 246, 0.35);border-radius:14px;padding:1.2rem 1.4rem;margin-bottom:1.5rem;display:flex;align-items:flex-start;gap:.9rem;">
        <span style="font-size:1.5rem;">💡</span>
        <div>
          <h4 style="font-size:1rem;font-weight:700;color:#ffffff;margin-bottom:.3rem;">Syllabus Coverage Gap Insight</h4>
          <p style="font-size:.84rem;color:var(--text-secondary);line-height:1.45;">
            While high-yield recurring topics deserve priority study time, <strong>uncovered topics must NOT be ignored</strong>. University question committees frequently introduce fresh questions from previously unexamined units to balance exams.
          </p>
        </div>
      </div>

      <div class="pyq-coverage-row">
        <!-- COVERED TOPICS -->
        <div class="pyq-coverage-col">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
            <h4 style="font-size:1.05rem;font-weight:700;color:#34d399;">✓ Examined in Past Papers (${covered.length})</h4>
            <span class="p-pill p-pill-low">${coverage.coveragePercentage}% of Syllabus</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:.6rem;">
            ${covered.length ? covered.map(c => `
              <div class="pyq-cov-item pyq-cov-covered">
                <div style="font-size:.92rem;font-weight:700;color:#ffffff;">${this.escapeHtml(c.topicName)}</div>
                <div style="font-size:.78rem;color:var(--muted);margin-top:.2rem;">
                  ${this.escapeHtml(c.unit)} • Appeared <strong>${c.appearances} time${c.appearances > 1 ? 's' : ''}</strong> across ${c.paperCount} paper${c.paperCount > 1 ? 's' : ''}
                </div>
              </div>
            `).join('') : '<p style="color:var(--muted);font-size:.85rem;">No covered topics mapped.</p>'}
          </div>
        </div>

        <!-- UNCOVERED TOPICS -->
        <div class="pyq-coverage-col">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
            <h4 style="font-size:1.05rem;font-weight:700;color:#fbbf24;">⚠️ Uncovered Syllabus Topics (${uncovered.length})</h4>
            <span class="p-pill p-pill-medium">Requires Revision</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:.6rem;">
            ${uncovered.length ? uncovered.map(u => `
              <div class="pyq-cov-item pyq-cov-uncovered">
                <div style="font-size:.92rem;font-weight:700;color:#ffffff;">${this.escapeHtml(u.topicName)}</div>
                <div style="font-size:.78rem;color:var(--muted);margin-top:.2rem;">
                  ${this.escapeHtml(u.unit)} • Difficulty: <span style="text-transform:capitalize;color:#cbd5e1;">${u.difficulty || 'medium'}</span>
                </div>
                <div style="font-size:.76rem;color:#fde68a;margin-top:.35rem;">
                  ${this.escapeHtml(u.reason)}
                </div>
              </div>
            `).join('') : '<p style="color:#34d399;font-size:.85rem;">100% of syllabus topics have appeared in uploaded papers!</p>'}
          </div>
        </div>
      </div>
    `;
  },

  // ─── UPLOAD MODAL CONTROLLERS ───────────────────────────────
  openUploadModal(presetSubjectId = '') {
    this.uploadedFilesList = [];
    
    // Clear fields
    const modal = document.getElementById('pyq-upload-modal');
    if (!modal) return;

    document.getElementById('pyq-upload-error').style.display = 'none';
    document.getElementById('pyq-upload-files-list').innerHTML = '';
    document.getElementById('pyq-upload-input-view').style.display = 'block';
    document.getElementById('pyq-upload-loading-view').style.display = 'none';

    // Populate subject select inside upload modal
    const select = document.getElementById('pyq-modal-subject-select');
    const subjects = window.getSubs ? window.getSubs() : [];
    
    let opts = '<option value="">-- Choose Subject with Uploaded Syllabus --</option>';
    let firstSyllabusSubjectId = '';

    subjects.forEach(s => {
      const hasSyl = Array.isArray(s.units) && s.units.length > 0;
      if (hasSyl && !firstSyllabusSubjectId) firstSyllabusSubjectId = s.id;
      const sylBadge = hasSyl ? ` (📘 ${s.units.length} Units Syllabus)` : ' (⚠️ No Syllabus Uploaded)';
      opts += `<option value="${s.id}" ${s.id === presetSubjectId ? 'selected' : ''}>${this.escapeHtml(s.name)}${sylBadge}</option>`;
    });

    select.innerHTML = opts;

    const chosenSubjectId = presetSubjectId || firstSyllabusSubjectId || (subjects[0]?.id || '');
    if (chosenSubjectId) {
      select.value = chosenSubjectId;
    }

    this.onModalSubjectChange(chosenSubjectId);

    modal.classList.add('open');
    setTimeout(() => modal.querySelector('.modal-box').classList.add('open'), 10);
  },

  onModalSubjectChange(subjectId) {
    const subjects = window.getSubs ? window.getSubs() : [];
    const sub = subjects.find(s => s.id === subjectId);

    const nameInput = document.getElementById('pyq-modal-subject-name');
    const codeInput = document.getElementById('pyq-modal-course-code');
    const dateInput = document.getElementById('pyq-modal-exam-date');
    const statusBox = document.getElementById('pyq-modal-syllabus-status');
    const previewBox = document.getElementById('pyq-modal-syllabus-preview');

    if (!sub) {
      if (statusBox) {
        statusBox.innerHTML = `
          <div id="pyq-syllabus-card-wrapper" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:10px;padding:.75rem 1rem;transition:all .2s ease;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;">
              <div style="display:flex;align-items:center;gap:.6rem;">
                <span id="pyq-syllabus-icon" style="font-size:1.3rem;">⚠️</span>
                <div>
                  <div id="pyq-syllabus-title" style="font-size:.84rem;font-weight:700;color:#fbbf24;">Syllabus Required Before PYQ Analysis</div>
                  <div id="pyq-syllabus-subtitle" style="font-size:.76rem;color:#fde68a;">Please select an enrolled subject with an uploaded syllabus, or upload your course syllabus first.</div>
                </div>
              </div>
              <button type="button" onclick="window.openUploadModal ? window.openUploadModal() : openUploadModal()" class="btn-sm" style="background:#f59e0b;border:none;color:#000;font-size:.76rem;font-weight:700;padding:.4rem .75rem;border-radius:6px;cursor:pointer;white-space:nowrap;">
                📤 Upload Syllabus
              </button>
            </div>
            <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;margin-top:.65rem;padding-top:.55rem;border-top:1px solid rgba(245,158,11,0.25);font-size:.78rem;color:#fde68a;">
              <input type="checkbox" id="pyq-syllabus-confirmed-checkbox" onchange="PYQManager.onSyllabusCheckboxToggle(this.checked)" style="accent-color:#10b981;cursor:pointer;width:17px;height:17px;margin-top:1px;flex-shrink:0;">
              <span id="pyq-syllabus-checkbox-text"><strong>☑️ I have uploaded the syllabus / Confirm syllabus is available</strong><br><span style="font-size:.72rem;opacity:0.9;">Tick this box to allow question extraction and calculate topic priorities</span></span>
            </label>
          </div>
        `;
      }
      if (previewBox) previewBox.style.display = 'none';
      return;
    }

    if (nameInput) nameInput.value = sub.name || '';
    if (codeInput) codeInput.value = sub.courseCode || '';
    if (dateInput) dateInput.value = sub.examDate || '';

    const hasSyllabus = Array.isArray(sub.units) && sub.units.length > 0;

    if (hasSyllabus) {
      let topicsCount = 0;
      sub.units.forEach(u => topicsCount += (u.topics || []).length);

      if (statusBox) {
        statusBox.innerHTML = `
          <div id="pyq-syllabus-card-wrapper" style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:.75rem 1rem;transition:all .2s ease;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;">
              <div style="display:flex;align-items:center;gap:.6rem;">
                <span id="pyq-syllabus-icon" style="font-size:1.3rem;">✅</span>
                <div>
                  <div id="pyq-syllabus-title" style="font-size:.86rem;font-weight:700;color:#34d399;display:flex;align-items:center;gap:.4rem;">
                    <span>✓</span> Official Syllabus Linked: ${this.escapeHtml(sub.name)}
                  </div>
                  <div id="pyq-syllabus-subtitle" style="font-size:.76rem;color:var(--muted);">${sub.units.length} Units • ${topicsCount} Curriculum Topics ready for PYQ question mapping</div>
                </div>
              </div>
              <button type="button" onclick="PYQManager.toggleSyllabusPreview()" class="btn-sm" style="background:rgba(255,255,255,0.08);border:1px solid var(--border);color:#f1f5f9;font-size:.75rem;padding:.35rem .65rem;border-radius:6px;cursor:pointer;white-space:nowrap;">
                👁️ View Units (${sub.units.length})
              </button>
            </div>
            <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;margin-top:.6rem;padding-top:.5rem;border-top:1px solid rgba(255,255,255,0.08);font-size:.78rem;color:#a7f3d0;">
              <input type="checkbox" id="pyq-syllabus-confirmed-checkbox" checked onchange="PYQManager.onSyllabusCheckboxToggle(this.checked)" style="accent-color:#10b981;cursor:pointer;width:17px;height:17px;flex-shrink:0;">
              <span id="pyq-syllabus-checkbox-text"><strong style="color:#34d399;">✓ Syllabus Uploaded & Verified</strong> — Extraction and topic priorities enabled</span>
            </label>
          </div>
        `;
      }

      if (previewBox) {
        previewBox.innerHTML = `
          <div style="font-weight:700;color:#34d399;margin-bottom:.5rem;">Curriculum Outline for ${this.escapeHtml(sub.name)}:</div>
          ${sub.units.map((u, ui) => {
            const uTitle = u.title || `Unit ${u.unitNumber || ui + 1}`;
            const tList = (u.topics || []).map(t => typeof t === 'string' ? t : (t.title || t.name || '')).filter(Boolean);
            return `
              <div style="margin-bottom:.4rem;padding-bottom:.35rem;border-bottom:1px solid rgba(255,255,255,0.05);">
                <strong style="color:#ffffff;">Unit ${u.unitNumber || ui + 1}: ${this.escapeHtml(uTitle)}</strong>
                <div style="color:var(--muted);margin-top:.15rem;font-size:.75rem;">Topics: ${this.escapeHtml(tList.join(', ') || 'All core concepts')}</div>
              </div>
            `;
          }).join('')}
        `;
        previewBox.style.display = 'none';
      }
    } else {
      if (statusBox) {
        statusBox.innerHTML = `
          <div id="pyq-syllabus-card-wrapper" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:10px;padding:.75rem 1rem;transition:all .2s ease;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;">
              <div style="display:flex;align-items:center;gap:.6rem;">
                <span id="pyq-syllabus-icon" style="font-size:1.3rem;">⚠️</span>
                <div>
                  <div id="pyq-syllabus-title" style="font-size:.85rem;font-weight:700;color:#fbbf24;">Syllabus Required Before PYQ Analysis</div>
                  <div id="pyq-syllabus-subtitle" style="font-size:.76rem;color:#fde68a;">Please select an enrolled subject with an uploaded syllabus, or upload your course syllabus first.</div>
                </div>
              </div>
              <button type="button" onclick="window.openUploadModal ? window.openUploadModal() : openUploadModal()" class="btn-sm" style="background:#f59e0b;border:none;color:#000;font-size:.76rem;font-weight:700;padding:.4rem .75rem;border-radius:6px;cursor:pointer;white-space:nowrap;">
                📤 Upload Syllabus
              </button>
            </div>
            <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;margin-top:.65rem;padding-top:.55rem;border-top:1px solid rgba(245,158,11,0.25);font-size:.78rem;color:#fde68a;">
              <input type="checkbox" id="pyq-syllabus-confirmed-checkbox" onchange="PYQManager.onSyllabusCheckboxToggle(this.checked)" style="accent-color:#10b981;cursor:pointer;width:17px;height:17px;margin-top:1px;flex-shrink:0;">
              <span id="pyq-syllabus-checkbox-text"><strong>☑️ I have uploaded the syllabus / Confirm syllabus is available</strong><br><span style="font-size:.72rem;opacity:0.9;">Tick this box to allow question extraction and calculate topic priorities</span></span>
            </label>
          </div>
        `;
      }
      if (previewBox) previewBox.style.display = 'none';
    }

    // Check if this subject has existing analyzed papers to offer multi-year accumulation
    const accumulateBox = document.getElementById('pyq-modal-accumulate-box');
    const existingPapersNote = document.getElementById('pyq-modal-existing-papers-note');
    const existingAnalysis = this.pyqHistory.find(h => h.subjectId === subjectId) || (this.activeSubjectId === subjectId ? this.activeAnalysis : null);

    if (existingAnalysis && Array.isArray(existingAnalysis.papers) && existingAnalysis.papers.length > 0) {
      const existingYears = existingAnalysis.papers.map(p => p.year).filter(Boolean);
      if (accumulateBox) {
        accumulateBox.style.display = 'block';
        if (existingPapersNote) {
          existingPapersNote.innerHTML = `Found <strong>${existingAnalysis.papers.length} paper(s)</strong> already analyzed (${this.escapeHtml(existingYears.join(', '))}). New paper(s) will be merged to compute multi-year recurrence!`;
        }
        const accRadio = document.getElementById('pyq-mode-accumulate');
        if (accRadio) accRadio.checked = true;
      }
    } else {
      if (accumulateBox) accumulateBox.style.display = 'none';
    }
  },

  onSyllabusCheckboxToggle(isChecked) {
    const card = document.getElementById('pyq-syllabus-card-wrapper');
    const icon = document.getElementById('pyq-syllabus-icon');
    const title = document.getElementById('pyq-syllabus-title');
    const subtitle = document.getElementById('pyq-syllabus-subtitle');
    const checkText = document.getElementById('pyq-syllabus-checkbox-text');
    const errBox = document.getElementById('pyq-upload-error');

    if (isChecked) {
      if (card) {
        card.style.background = 'rgba(16,185,129,0.14)';
        card.style.borderColor = 'rgba(16,185,129,0.45)';
      }
      if (icon) icon.textContent = '✅';
      if (title) {
        title.innerHTML = '<span style="color:#34d399;display:flex;align-items:center;gap:.35rem;"><span>✓</span> Syllabus Confirmed &amp; Ready for Analysis</span>';
      }
      if (subtitle) {
        subtitle.innerHTML = '<span style="color:#a7f3d0;">Syllabus requirement confirmed! You can now extract questions and calculate topic priorities.</span>';
      }
      if (checkText) {
        checkText.innerHTML = '<strong style="color:#34d399;">✓ Syllabus Uploaded &amp; Confirmed</strong><br><span style="font-size:.72rem;color:#a7f3d0;">Extraction &amp; topic priority calculation enabled</span>';
      }
      if (errBox) errBox.style.display = 'none';
    } else {
      const select = document.getElementById('pyq-modal-subject-select');
      const subjectId = select ? select.value : '';
      const subjects = window.getSubs ? window.getSubs() : [];
      const sub = subjects.find(s => s.id === subjectId);
      const hasSyl = sub && Array.isArray(sub.units) && sub.units.length > 0;

      if (hasSyl) {
        if (card) {
          card.style.background = 'rgba(16,185,129,0.12)';
          card.style.borderColor = 'rgba(16,185,129,0.35)';
        }
        if (icon) icon.textContent = '📘';
        if (title) {
          title.innerHTML = `<span style="color:#34d399;">Official Syllabus Linked: ${this.escapeHtml(sub.name)}</span>`;
        }
        if (subtitle) {
          subtitle.innerHTML = `<span style="color:var(--muted);">${sub.units.length} Units • Ready for PYQ question mapping</span>`;
        }
        if (checkText) {
          checkText.innerHTML = '<span>Tick box to confirm syllabus verification</span>';
        }
      } else {
        if (card) {
          card.style.background = 'rgba(245,158,11,0.12)';
          card.style.borderColor = 'rgba(245,158,11,0.35)';
        }
        if (icon) icon.textContent = '⚠️';
        if (title) {
          title.innerHTML = `<span style="color:#fbbf24;">Syllabus Required Before PYQ Analysis</span>`;
        }
        if (subtitle) {
          subtitle.innerHTML = `<span style="color:#fde68a;">Please select an enrolled subject with an uploaded syllabus, or upload your course syllabus first.</span>`;
        }
        if (checkText) {
          checkText.innerHTML = '<strong>☑️ I have uploaded the syllabus / Confirm syllabus is available</strong><br><span style="font-size:.72rem;opacity:0.9;">Tick this box to allow question extraction and calculate topic priorities</span>';
        }
      }
    }
  },

  toggleSyllabusPreview() {
    const previewBox = document.getElementById('pyq-modal-syllabus-preview');
    if (previewBox) {
      previewBox.style.display = previewBox.style.display === 'none' ? 'block' : 'none';
    }
  },

  closeUploadModal() {
    const modal = document.getElementById('pyq-upload-modal');
    if (modal) {
      modal.querySelector('.modal-box').classList.remove('open');
      setTimeout(() => modal.classList.remove('open'), 280);
    }
  },

  handleFilesSelected(files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.match(/\.(pdf|txt|png|jpe?g|webp)$/i)) {
        alert(`File "${file.name}" is not supported. Please upload PDF, TXT, or Image files.`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds 20MB limit.`);
        continue;
      }

      // Try to auto-detect year from filename (e.g. 2024, 2023, 2022)
      const yearMatch = file.name.match(/\b(201\d|202\d)\b/);
      const defaultYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear() - (this.uploadedFilesList.length));

      this.uploadedFilesList.push({
        id: `f_${Date.now()}_${i}`,
        file,
        year: defaultYear
      });
    }

    this.renderUploadedFilesList();
  },

  renderUploadedFilesList() {
    const container = document.getElementById('pyq-upload-files-list');
    if (!container) return;

    if (!this.uploadedFilesList.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.uploadedFilesList.map((item, idx) => `
      <div class="pyq-upload-item">
        <div class="pyq-file-info">
          <span>📄</span>
          <span title="${this.escapeHtml(item.file.name)}">${this.escapeHtml(item.file.name)}</span>
          <span style="font-size:.74rem;color:var(--muted);">(${Math.round(item.file.size / 1024)} KB)</span>
        </div>
        <div style="display:flex;align-items:center;gap:.6rem;">
          <label style="font-size:.76rem;color:var(--muted);">Exam Year:</label>
          <input type="text" class="pyq-year-input" value="${this.escapeHtml(item.year)}" oninput="PYQManager.updateFileYear('${item.id}', this.value)" placeholder="e.g. 2024">
          <button type="button" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:1rem;" onclick="PYQManager.removeUploadedFile('${item.id}')" title="Remove Paper">✕</button>
        </div>
      </div>
    `).join('');
  },

  updateFileYear(id, yearVal) {
    const item = this.uploadedFilesList.find(f => f.id === id);
    if (item) item.year = yearVal;
  },

  removeUploadedFile(id) {
    this.uploadedFilesList = this.uploadedFilesList.filter(f => f.id !== id);
    this.renderUploadedFilesList();
  },

  async submitUploadAndAnalyze() {
    const err = document.getElementById('pyq-upload-error');
    err.style.display = 'none';

    const select = document.getElementById('pyq-modal-subject-select');
    let subjectId = select.value;
    let subjectName = document.getElementById('pyq-modal-subject-name').value.trim();
    const courseCode = document.getElementById('pyq-modal-course-code').value.trim();
    const university = document.getElementById('pyq-modal-university').value.trim();
    const semester = document.getElementById('pyq-modal-semester').value.trim();
    const examDate = document.getElementById('pyq-modal-exam-date').value;
    const pastedText = document.getElementById('pyq-modal-pasted-text').value.trim();

    if (!subjectName && select.value) {
      const selectedOption = select.options[select.selectedIndex];
      subjectName = selectedOption.textContent.replace(/\s*\([^)]*\)/g, '').trim();
    }

    if (!subjectName) {
      err.textContent = 'Please provide a Subject Name.';
      err.style.display = 'block';
      return;
    }

    // Mandatory Syllabus Check
    const subjects = window.getSubs ? window.getSubs() : [];
    let selectedSub = subjects.find(s => s.id === subjectId || (s.name && s.name.toLowerCase().trim() === subjectName.toLowerCase().trim()));

    const syllabusCheckbox = document.getElementById('pyq-syllabus-confirmed-checkbox');
    const isSyllabusConfirmed = (syllabusCheckbox && syllabusCheckbox.checked) || (selectedSub && Array.isArray(selectedSub.units) && selectedSub.units.length > 0);

    if (!isSyllabusConfirmed) {
      err.innerHTML = `
        <strong>Syllabus Required:</strong> Please tick the syllabus confirmation box <strong>"☑️ I have uploaded / confirm the syllabus"</strong> above or upload your syllabus to allow question extraction and topic priority calculation.<br>
        <button type="button" onclick="window.openUploadModal ? window.openUploadModal() : openUploadModal()" style="margin-top:.6rem;background:#f59e0b;border:none;color:#000;font-size:.78rem;font-weight:700;padding:.35rem .75rem;border-radius:6px;cursor:pointer;">
          📤 Upload Course Syllabus Now
        </button>
      `;
      err.style.display = 'block';
      return;
    }

    if (!this.uploadedFilesList.length && (!pastedText || pastedText.length < 20)) {
      err.textContent = 'Please add at least one question paper PDF or paste exam questions.';
      err.style.display = 'block';
      return;
    }

    // Switch to loading view
    document.getElementById('pyq-upload-input-view').style.display = 'none';
    document.getElementById('pyq-upload-loading-view').style.display = 'block';
    const msgs = [
      "Reading course syllabus outline",
      "Scanning previous exam papers",
      "Matching questions to syllabus units",
      "Calculating topic recurrence & weightage across all years",
      "Detecting unexamined syllabus topics"
    ];
    let msgIdx = 0;
    const msgEl = document.getElementById('pyq-loading-msg');
    if (msgEl) msgEl.textContent = msgs[0];
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % msgs.length;
      if (msgEl) {
        msgEl.style.animation = 'none';
        void msgEl.offsetWidth;
        msgEl.style.animation = '';
        msgEl.textContent = msgs[msgIdx];
      }
    }, 1900);

    const formData = new FormData();
    formData.append('subjectId', (selectedSub && selectedSub.id) || subjectId || `sub_${Date.now()}`);
    formData.append('subjectName', subjectName);
    if (courseCode) formData.append('courseCode', courseCode);
    if (university) formData.append('university', university);
    if (semester) formData.append('semester', semester);
    if (examDate) formData.append('examDate', examDate);

    // Multi-Year Accumulation Mode
    const uploadMode = document.querySelector('input[name="pyq_upload_mode"]:checked')?.value || 'accumulate';
    formData.append('replaceExisting', uploadMode === 'replace' ? 'true' : 'false');

    // Attach syllabus units (or structured fallback units if confirmed without prior upload)
    let unitsToSend = (selectedSub && Array.isArray(selectedSub.units) && selectedSub.units.length > 0) ? selectedSub.units : [
      { unitNumber: 1, title: `Unit 1: Fundamentals & Core Concepts`, topics: [`Foundations of ${subjectName}`, 'Core Principles & Definitions', 'Basic Theoretical Models'] },
      { unitNumber: 2, title: `Unit 2: Analytical Methods & Formulations`, topics: ['Mathematical & Analytical Formulations', 'Key Theorems & Methods', 'Standard Equations'] },
      { unitNumber: 3, title: `Unit 3: Applied Techniques & Algorithms`, topics: ['Algorithm Design & Problem Solving', 'Analysis Methods', 'System Techniques'] },
      { unitNumber: 4, title: `Unit 4: Advanced Systems & Architecture`, topics: ['Advanced Concepts', 'System Architecture', 'Performance Optimization'] },
      { unitNumber: 5, title: `Unit 5: Applications, Design & Emerging Trends`, topics: ['Practical Applications', 'Case Studies & Synthesis', 'Modern Implementations'] }
    ];

    formData.append('syllabusUnits', JSON.stringify(unitsToSend));
    formData.append('syllabusConfirmed', 'true');

    const yearsArray = this.uploadedFilesList.map(f => f.year || '2024');
    formData.append('years', JSON.stringify(yearsArray));

    if (pastedText) {
      formData.append('pastedPaperText', pastedText);
    }

    this.uploadedFilesList.forEach(item => {
      formData.append('papers', item.file);
    });

    try {
      const res = await fetch('/api/pyq/upload-analyze', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('studyflow_auth_token') || ''}`,
          'x-auth-token': localStorage.getItem('studyflow_auth_token') || ''
        },
        body: formData
      });

      clearInterval(interval);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Analysis failed.');
      }

      this.closeUploadModal();
      window.showToast?.(data.message || 'Multi-year question papers analyzed and merged! 🎉', 'success');
      
      await this.loadSubjectsAndHistory();
      this.selectSubjectAnalysis(data.data.subjectId);

    } catch (e) {
      clearInterval(interval);
      document.getElementById('pyq-upload-input-view').style.display = 'block';
      document.getElementById('pyq-upload-loading-view').style.display = 'none';
      err.innerHTML = e.message || 'Error processing question papers.';
      err.style.display = 'block';
    }
  },

  async deletePaper(paperId, paperYear = '') {
    if (!this.activeSubjectId) return;
    if (!confirm(`Are you sure you want to remove the ${paperYear ? `Year ${paperYear}` : ''} question paper? Topic priorities and frequency scores will be recalculated across the remaining years.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/pyq/paper/${encodeURIComponent(this.activeSubjectId)}/${encodeURIComponent(paperId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('studyflow_auth_token') || ''}`,
          'x-auth-token': localStorage.getItem('studyflow_auth_token') || ''
        }
      });
      const data = await res.json();

      if (res.ok && data.success) {
        window.showToast?.(data.message || 'Paper removed and priorities recalculated.', 'info');
        await this.loadSubjectsAndHistory();
        if (data.data) {
          this.activeAnalysis = data.data;
          this.renderActiveAnalysis();
        } else {
          this.selectSubjectAnalysis(this.activeSubjectId);
        }
      } else {
        alert(data.message || 'Failed to remove paper.');
      }
    } catch (e) {
      alert('Error removing paper: ' + e.message);
    }
  },

  // ─── RECLASSIFICATION MODAL ─────────────────────────────────
  openReclassifyModal(questionId) {
    if (!this.activeAnalysis) return;
    const q = (this.activeAnalysis.questions || []).find(x => x.id === questionId);
    if (!q) return;

    document.getElementById('reclass-question-id').value = q.id;
    document.getElementById('reclass-qtext').textContent = q.questionText;
    document.getElementById('reclass-topic').value = q.matchedTopic;
    document.getElementById('reclass-unit').value = q.detectedUnit || '';
    document.getElementById('reclass-marks').value = (typeof q.marks === 'number') ? q.marks : '';
    document.getElementById('reclass-notes').value = q.userNotes || '';

    const modal = document.getElementById('pyq-reclassify-modal');
    if (modal) {
      modal.classList.add('open');
      setTimeout(() => modal.querySelector('.modal-box').classList.add('open'), 10);
    }
  },

  closeReclassifyModal() {
    const modal = document.getElementById('pyq-reclassify-modal');
    if (modal) {
      modal.querySelector('.modal-box').classList.remove('open');
      setTimeout(() => modal.classList.remove('open'), 280);
    }
  },

  async saveReclassification() {
    const qId = document.getElementById('reclass-question-id').value;
    const topic = document.getElementById('reclass-topic').value.trim();
    const unit = document.getElementById('reclass-unit').value.trim();
    const marksVal = document.getElementById('reclass-marks').value;
    const notes = document.getElementById('reclass-notes').value.trim();

    if (!topic) {
      alert('Topic name cannot be empty.');
      return;
    }

    try {
      const res = await fetch(`/api/pyq/question/${encodeURIComponent(this.activeSubjectId)}/${encodeURIComponent(qId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          matchedTopic: topic,
          detectedUnit: unit,
          marks: marksVal ? parseInt(marksVal, 10) : null,
          userNotes: notes
        })
      });

      const data = await res.json();
      if (data.success && data.data) {
        this.activeAnalysis = data.data;
        this.closeReclassifyModal();
        window.showToast?.('Classification updated and priorities recalculated! 🎯', 'success');
        this.renderActiveAnalysis();
      } else {
        alert(data.message || 'Could not update classification.');
      }
    } catch (e) {
      alert('Error updating question classification.');
    }
  },

  // ─── CREATE STUDY PLAN FROM ANALYSIS MODAL ──────────────────
  openStudyPlanModal() {
    if (!this.activeAnalysis) return;
    const a = this.activeAnalysis;

    const modal = document.getElementById('pyq-plan-modal');
    if (!modal) return;

    document.getElementById('plan-modal-subname').textContent = a.subjectName;
    document.getElementById('plan-modal-exam-date').value = a.examDate || '';
    document.getElementById('plan-modal-hours').value = '3.0';

    // Render topics review list
    const topicsListEl = document.getElementById('plan-modal-topics-list');
    topicsListEl.innerHTML = (a.topicPriorities || []).map((t, idx) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem;background:rgba(255, 255, 255, 0.03);border-radius:8px;border:1px solid var(--border);margin-bottom:.45rem;">
        <div>
          <span style="font-weight:700;color:#ffffff;font-size:.88rem;">${this.escapeHtml(t.topicName)}</span>
          <span style="font-size:.74rem;color:var(--muted);margin-left:.5rem;">(${t.paperCount}/${t.totalPaperCount} Papers)</span>
        </div>
        <span class="p-pill ${t.priorityLevel === 'High' ? 'p-pill-high' : (t.priorityLevel === 'Medium' ? 'p-pill-medium' : 'p-pill-low')}">
          ${t.priorityLevel}
        </span>
      </div>
    `).join('');

    modal.classList.add('open');
    setTimeout(() => modal.querySelector('.modal-box').classList.add('open'), 10);
  },

  closeStudyPlanModal() {
    const modal = document.getElementById('pyq-plan-modal');
    if (modal) {
      modal.querySelector('.modal-box').classList.remove('open');
      setTimeout(() => modal.classList.remove('open'), 280);
    }
  },

  async confirmGenerateStudyPlan() {
    if (!this.activeAnalysis) return;

    const examDate = document.getElementById('plan-modal-exam-date').value;
    const dailyStudyHours = parseFloat(document.getElementById('plan-modal-hours').value) || 3.0;

    try {
      const res = await fetch('/api/pyq/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subjectId: this.activeSubjectId,
          examDate,
          dailyStudyHours,
          overrideExistingSessions: true
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate study plan.');
      }

      this.closeStudyPlanModal();
      window.showToast?.(`Study Plan Created with ${data.data.scheduledSessions.length} prioritized sessions! 🚀`, 'success');

      // Refresh cloud sync and dashboard
      if (window.AuthManager) {
        const freshData = await AuthManager.fetchUserData();
        if (freshData && window.getUserKey) {
          localStorage.setItem(getUserKey('subjects'), JSON.stringify(freshData.subjects || []));
          localStorage.setItem(getUserKey('sessions'), JSON.stringify(freshData.sessions || []));
          localStorage.setItem(getUserKey('activity'), JSON.stringify(freshData.activity || []));
        }
      }

      // Switch to dashboard home tab and re-render
      const homeTab = document.querySelector('.sidebar-nav .nav-item[data-tab="home"]');
      if (homeTab) homeTab.click();

    } catch (e) {
      alert(e.message || 'Error generating study plan.');
    }
  },

  setupEventListeners() {
    // Subject selector change
    const sel = document.getElementById('pyq-subject-selector');
    if (sel) {
      sel.addEventListener('change', (e) => {
        this.selectSubjectAnalysis(e.target.value);
      });
    }

    // Dropzone in upload modal
    const dropzone = document.getElementById('pyq-modal-dropzone');
    const fileInput = document.getElementById('pyq-modal-file-input');
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) this.handleFilesSelected(e.target.files);
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) this.handleFilesSelected(e.dataTransfer.files);
      });
    }

    // Modal subject selector change
    const mSelect = document.getElementById('pyq-modal-subject-select');
    if (mSelect) {
      mSelect.addEventListener('change', (e) => {
        const subId = e.target.value;
        const subjects = window.getSubs ? window.getSubs() : [];
        const sub = subjects.find(s => s.id === subId);
        if (sub) {
          document.getElementById('pyq-modal-subject-name').value = sub.name;
          document.getElementById('pyq-modal-exam-date').value = sub.examDate || '';
        }
      });
    }
  },

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

window.PYQManager = PYQManager;
