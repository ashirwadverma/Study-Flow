# Smart Study Planner 📚✨

An intelligent, AI-powered study planner and syllabus breakdown assistant designed to help students organize their syllabus, analyze Previous Year Questions (PYQs), generate customized study schedules, and take targeted assessments.

---

## 🚀 Features

- **AI-Powered Syllabus Parsing:** Upload syllabus documents (PDF) and let Google Gemini AI extract subjects, modules, and subtopics automatically.
- **PYQ (Previous Year Questions) Analysis:** Upload past papers to identify high-weightage topics and prioritize your preparation.
- **Interactive Dashboard:** Track completed topics, revision schedules, and mastery percentages with visual charts.
- **Adaptive Assessments & Quizzes:** Auto-generated topical quizzes with instant feedback and score tracking.
- **User Authentication:** Complete signup/login system with session management and email verification support.
- **Dual Persistence:** Works with MongoDB / MongoDB Atlas, with an automated fallback local data store.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js (v5)
- **Database:** MongoDB & Mongoose (with fallback file adapter)
- **AI Integration:** Google Gemini API (`@google/genai`)
- **Document Processing:** `pdf-parse`, `multer`
- **Frontend:** Vanilla HTML5, CSS3, Modern ES6+ JavaScript

---

## 📋 Prerequisites

Before running the application, make sure you have:
1. **Node.js** (v18.x or later) installed — [Download Node.js](https://nodejs.org/)
2. **MongoDB** (Optional): A local MongoDB instance or a free MongoDB Atlas connection string.
3. **Gemini API Key**: A free API key from [Google AI Studio](https://aistudio.google.com/).

---

## ⚡ Quick Start

### 1. Extract the Files
Extract the contents of this zip archive to your desired project directory.

### 2. Install Dependencies
Open your terminal in the extracted folder and run:
```bash
npm install
```

### 3. Environment Configuration
Check the `.env` file (or copy from `.env.example`):
```bash
# Example configuration
PORT=5000
NODE_ENV=development
APP_URL=http://localhost:5000
SESSION_SECRET=your_secret_key_here
MONGODB_URI=mongodb://127.0.0.1:27017/syllabus_study_planner
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### 4. Run the Application

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production / Standard Mode:**
```bash
npm start
```

### 5. Access the Web Application
Open your web browser and navigate to:
```
http://localhost:5000
```

---

## 📁 Project Structure

```
Smart_Study_Planner/
├── assets/             # Project assets and design references
├── css/                # Styling (style.css, dashboard.css)
├── js/                 # Client-side scripts (app.js, dashboard.js, assessment.js, etc.)
├── server/             # Express server architecture
│   ├── config/         # Database and server configuration
│   ├── controllers/    # API controllers
│   ├── middleware/     # Auth and rate limiting middleware
│   ├── models/         # Mongoose models
│   ├── routes/         # Express router endpoints
│   ├── services/       # AI, PDF extraction & DB adapter services
│   └── utils/          # Helper utilities
├── uploads/            # Temporary storage for uploaded PDFs
├── dashboard.html      # User dashboard view
├── index.html          # Landing and login page
├── verify-email.html   # Email verification landing page
├── package.json        # Node.js project manifest & dependencies
└── README.md           # Project documentation
```

---

## 📄 License
ISC License
