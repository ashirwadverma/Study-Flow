/**
 * storage.js
 * Handles all LocalStorage interactions for the Syllabus Study Planner
 */

const STORAGE_KEYS = {
    STUDENT_INFO: 'ssp_student_info',
    SYLLABUS: 'ssp_syllabus',
    CONSTRAINTS: 'ssp_constraints',
    GENERATED_PLAN: 'ssp_generated_plan',
    COMPLETED_SESSIONS: 'ssp_completed_sessions',
    THEME_PREFERENCE: 'ssp_theme',
    NOTES: 'ssp_notes',
    REVISION_DATA: 'ssp_revision_data',
    SETTINGS: 'ssp_settings',
    SESSION_ACTIVITY: 'ssp_session_activity',
    DEADLINES: 'ssp_deadlines'
};

const StorageService = {
    // Save data to localStorage
    save: (key, data) => {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Error saving to localStorage:', e);
            return false;
        }
    },

    // Load data from localStorage
    load: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('Error loading from localStorage:', e);
            return defaultValue;
        }
    },

    // Remove specific key
    remove: (key) => {
        localStorage.removeItem(key);
    },

    // Save Student Information
    saveStudentInfo: (info) => StorageService.save(STORAGE_KEYS.STUDENT_INFO, info),
    getStudentInfo: () => StorageService.load(STORAGE_KEYS.STUDENT_INFO, { name: '', course: '', semester: '' }),

    // Save Syllabus (Subjects and Topics)
    saveSyllabus: (syllabus) => StorageService.save(STORAGE_KEYS.SYLLABUS, syllabus),
    getSyllabus: () => StorageService.load(STORAGE_KEYS.SYLLABUS, []),

    // Save Constraints (Exam Date, Daily Hours)
    saveConstraints: (constraints) => StorageService.save(STORAGE_KEYS.CONSTRAINTS, constraints),
    getConstraints: () => StorageService.load(STORAGE_KEYS.CONSTRAINTS, null),

    // Save/Load Generated Plan
    saveGeneratedPlan: (plan) => StorageService.save(STORAGE_KEYS.GENERATED_PLAN, plan),
    getGeneratedPlan: () => StorageService.load(STORAGE_KEYS.GENERATED_PLAN, null),

    // Save/Load Completed Sessions array (stores session IDs)
    saveCompletedSessions: (sessions) => StorageService.save(STORAGE_KEYS.COMPLETED_SESSIONS, sessions),
    getCompletedSessions: () => StorageService.load(STORAGE_KEYS.COMPLETED_SESSIONS, []),

    // Helper: Mark a session as complete/incomplete
    toggleSessionCompletion: (sessionId, isComplete) => {
        let completed = StorageService.getCompletedSessions();
        if (isComplete) {
            if (!completed.includes(sessionId)) completed.push(sessionId);
        } else {
            completed = completed.filter(id => id !== sessionId);
        }
        StorageService.saveCompletedSessions(completed);
        return completed;
    },

    // Rich activity records keep planned and actual study time separate.
    getSessionActivity: () => StorageService.load(STORAGE_KEYS.SESSION_ACTIVITY, {}),
    saveSessionActivity: (activity) => StorageService.save(STORAGE_KEYS.SESSION_ACTIVITY, activity),
    getSessionRecord: (sessionId) => StorageService.getSessionActivity()[sessionId] || {},
    saveSessionRecord: (sessionId, record) => {
        const activity = StorageService.getSessionActivity();
        activity[sessionId] = { ...activity[sessionId], ...record };
        StorageService.saveSessionActivity(activity);
        return activity[sessionId];
    },
    recordStudyMinutes: (sessionId, minutes) => StorageService.saveSessionRecord(sessionId, {
        actualMinutes: Math.max(0, Math.round(minutes)),
        lastStudiedAt: new Date().toISOString()
    }),
    getActualMinutes: () => Object.values(StorageService.getSessionActivity())
        .reduce((total, record) => total + (Number(record.actualMinutes) || 0), 0),
    getStudyDates: () => {
        const dates = new Set();
        Object.values(StorageService.getSessionActivity()).forEach(record => {
            if (record.completedAt) dates.add(new Date(record.completedAt).toDateString());
            else if (record.lastStudiedAt) dates.add(new Date(record.lastStudiedAt).toDateString());
        });
        return dates;
    },
    getStudyStreak: () => {
        const dates = StorageService.getStudyDates();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let cursor = new Date(today);
        let current = 0;

        if (!dates.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
        while (dates.has(cursor.toDateString())) {
            current++;
            cursor.setDate(cursor.getDate() - 1);
        }

        let longest = 0;
        const sortedDates = [...dates].map(date => new Date(date).setHours(0, 0, 0, 0)).sort((a, b) => a - b);
        let run = 0;
        sortedDates.forEach((date, index) => {
            run = index > 0 && date - sortedDates[index - 1] === 86400000 ? run + 1 : 1;
            longest = Math.max(longest, run);
        });
        return { current, longest, lastActiveDate: sortedDates.length ? new Date(sortedDates.at(-1)).toISOString() : null };
    },

    // Deadlines are independent records so they can be shown by every page.
    getDeadlines: () => StorageService.load(STORAGE_KEYS.DEADLINES, []),
    saveDeadlines: (deadlines) => StorageService.save(STORAGE_KEYS.DEADLINES, deadlines),
    addDeadline: (deadline) => {
        const deadlines = StorageService.getDeadlines();
        const record = { id: `deadline_${Date.now()}`, completed: false, ...deadline };
        deadlines.push(record);
        StorageService.saveDeadlines(deadlines);
        return record;
    },
    updateDeadline: (id, updates) => {
        const deadlines = StorageService.getDeadlines().map(deadline => deadline.id === id ? { ...deadline, ...updates } : deadline);
        StorageService.saveDeadlines(deadlines);
        return deadlines;
    },
    deleteDeadline: (id) => {
        const deadlines = StorageService.getDeadlines().filter(deadline => deadline.id !== id);
        StorageService.saveDeadlines(deadlines);
        return deadlines;
    },

    // Save/Load Notes
    saveNotes: (notes) => StorageService.save(STORAGE_KEYS.NOTES, notes),
    getNotes: () => StorageService.load(STORAGE_KEYS.NOTES, {}),

    // Save/Load Revision Data
    saveRevisionData: (data) => StorageService.save(STORAGE_KEYS.REVISION_DATA, data),
    getRevisionData: () => StorageService.load(STORAGE_KEYS.REVISION_DATA, {}),

    // Save/Load Settings
    saveSettings: (settings) => StorageService.save(STORAGE_KEYS.SETTINGS, settings),
    getSettings: () => StorageService.load(STORAGE_KEYS.SETTINGS, { defaultHours: 4 }),


    // Clear all planner data (used for Reset)
    clearAllPlannerData: () => {
        StorageService.remove(STORAGE_KEYS.STUDENT_INFO);
        StorageService.remove(STORAGE_KEYS.SYLLABUS);
        StorageService.remove(STORAGE_KEYS.CONSTRAINTS);
        StorageService.remove(STORAGE_KEYS.GENERATED_PLAN);
        StorageService.remove(STORAGE_KEYS.COMPLETED_SESSIONS);
        StorageService.remove(STORAGE_KEYS.NOTES);
        StorageService.remove(STORAGE_KEYS.REVISION_DATA);
        StorageService.remove(STORAGE_KEYS.SESSION_ACTIVITY);
        StorageService.remove(STORAGE_KEYS.DEADLINES);
        // We usually don't remove settings/theme on clear data, but can if needed.
    }
};

window.StorageService = StorageService;
