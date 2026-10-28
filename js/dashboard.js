/**
 * dashboard.js
 * Handles logic for the analytics dashboard
 */

document.addEventListener('DOMContentLoaded', () => {
    const emptyState = document.getElementById('empty-state');
    const dashboardContent = document.getElementById('dashboard-content');

    const init = () => {
        const currentPlanData = StorageService.getGeneratedPlan();
        const syllabus = StorageService.getSyllabus();
        const completedSessions = StorageService.getCompletedSessions();
        const constraints = StorageService.getConstraints();
        const actualMinutes = StorageService.getActualMinutes();
        const streak = StorageService.getStudyStreak();

        if (!currentPlanData || !syllabus) {
            emptyState.classList.remove('hidden');
            return;
        }

        dashboardContent.classList.remove('hidden');

        // Extract metrics
        let totalTopics = 0;
        let totalCompletedTopics = 0;
        let totalHours = 0;
        let completedHours = 0;
        
        let subjectProgress = {};
        let weakTopics = [];
        let upcomingSessions = [];

        // Pre-process syllabus for subjects and weak topics
        syllabus.forEach(sub => {
            let subTotalTopics = 0;
            let subCompletedTopics = 0;
            
            sub.topics.forEach(topic => {
                totalTopics++;
                subTotalTopics++;
                
                const topicId = `${sub.name.replace(/\s+/g, '_')}_${topic.name.replace(/\s+/g, '_')}`;
                const isCompleted = completedSessions.includes(topicId);
                const hours = parseFloat(topic.hours) || 1;
                
                totalHours += hours;
                
                if (isCompleted) {
                    totalCompletedTopics++;
                    subCompletedTopics++;
                    completedHours += hours;
                }

                if (topic.isWeak) {
                    weakTopics.push({
                        subject: sub.name,
                        topic: topic.name,
                        completed: isCompleted
                    });
                }
            });

            subjectProgress[sub.name] = {
                total: subTotalTopics,
                completed: subCompletedTopics,
                percent: subTotalTopics > 0 ? Math.round((subCompletedTopics / subTotalTopics) * 100) : 0
            };
        });

        // 1. Render Top Stats
        const statsGrid = document.getElementById('stats-grid');
        let daysLeft = 0;
        if (constraints && constraints.examDate) {
            const today = new Date();
            today.setHours(0,0,0,0);
            const examDate = new Date(constraints.examDate);
            daysLeft = Math.max(0, Math.ceil((examDate - today) / (1000 * 60 * 60 * 24)));
        }

        const remainingTopics = totalTopics - totalCompletedTopics;
        const remainingHours = totalHours - completedHours;

        statsGrid.innerHTML = `
            <div class="card stat-card"><div class="stat-value">${totalTopics}</div><div class="stat-label">Total Topics</div></div>
            <div class="card stat-card"><div class="stat-value">${totalCompletedTopics}</div><div class="stat-label">Completed Topics</div></div>
            <div class="card stat-card"><div class="stat-value">${remainingTopics}</div><div class="stat-label">Remaining Topics</div></div>
            <div class="card stat-card"><div class="stat-value">${(actualMinutes / 60).toFixed(1)}</div><div class="stat-label">Actual Hours</div></div>
            <div class="card stat-card"><div class="stat-value">${remainingHours}</div><div class="stat-label">Hours Remaining</div></div>
            <div class="card stat-card"><div class="stat-value">${daysLeft}</div><div class="stat-label">Exam Countdown (Days)</div></div>
            <div class="card stat-card"><div class="stat-value">${streak.current}</div><div class="stat-label">Current Streak (Days)</div></div>
        `;

        // 2. Render Overall Progress
        const overallProgressPercent = totalTopics > 0 ? Math.round((totalCompletedTopics / totalTopics) * 100) : 0;
        document.getElementById('overall-progress-text').textContent = `${overallProgressPercent}%`;
        document.getElementById('circular-progress').style.background = `conic-gradient(var(--accent-color) ${overallProgressPercent}%, var(--border-color) ${overallProgressPercent}%)`;

        // 3. Render Subject Progress
        const subjectProgressList = document.getElementById('subject-progress-list');
        for (const [subject, data] of Object.entries(subjectProgress)) {
            subjectProgressList.innerHTML += `
                <div class="subject-progress-item">
                    <div class="subject-progress-header">
                        <span>${subject}</span>
                        <span>${data.percent}%</span>
                    </div>
                    <div class="progress-container">
                        <div class="progress-bar" style="width: ${data.percent}%"></div>
                    </div>
                </div>
            `;
        }

        // 4. Render Weak Topics
        const weakTopicsList = document.getElementById('weak-topics-list');
        if (weakTopics.length > 0) {
            weakTopics.forEach(wt => {
                const statusIcon = wt.completed ? '✅' : '❌';
                const style = wt.completed ? 'text-decoration: line-through; opacity: 0.6;' : '';
                weakTopicsList.innerHTML += `
                    <li style="${style}">
                        <div>
                            <strong>${wt.subject}</strong>: ${wt.topic}
                        </div>
                        <div>${statusIcon}</div>
                    </li>
                `;
            });
        } else {
            weakTopicsList.innerHTML = `<li class="text-muted">No weak topics marked. Great job!</li>`;
        }

        // 5. Render Upcoming Sessions
        // Find the first few incomplete sessions from the plan
        const upcomingList = document.getElementById('upcoming-sessions-list');
        let sessionsFound = 0;
        
        if (currentPlanData.plan) {
            for (let day of currentPlanData.plan) {
                for (let session of day.sessions) {
                    if (!completedSessions.includes(session.id) && sessionsFound < 3) {
                        const dateStr = new Date(day.date).toLocaleDateString();
                        upcomingList.innerHTML += `
                            <div class="upcoming-session-item">
                                <div style="font-weight: 600; margin-bottom: 0.25rem;">Day ${day.dayNumber} (${dateStr})</div>
                                <div style="color: var(--text-secondary); font-size: 0.95rem;">${session.subjectName} - ${session.topicName}</div>
                                <div style="margin-top: 0.5rem;"><span class="badge" style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">${session.hours} Hours</span></div>
                            </div>
                        `;
                        sessionsFound++;
                    }
                }
            }
        }

        if (sessionsFound === 0) {
            upcomingList.innerHTML = `<p class="text-muted text-center py-4">No upcoming sessions. You're all caught up!</p>`;
        }

        const deadlinesList = document.getElementById('dashboard-deadlines-list');
        const deadlines = StorageService.getDeadlines().filter(deadline => !deadline.completed).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
        deadlinesList.innerHTML = deadlines.length ? deadlines.map(deadline => {
            const days = Math.ceil((new Date(`${deadline.date}T00:00:00`) - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
            return `<div class="flex justify-between items-center" style="padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);"><div><strong>${deadline.title}</strong><div class="text-muted">${deadline.type} · ${days < 0 ? 'Past due' : days === 0 ? 'Due today' : `Due in ${days} days`}</div></div><span class="badge">${deadline.priority}</span></div>`;
        }).join('') : '<p class="text-muted">No upcoming deadlines.</p>';

        // 6. Render Calendar View
        const calendarContainer = document.getElementById('calendar-container');
        if (calendarContainer && currentPlanData.plan) {
            calendarContainer.innerHTML = '';
            currentPlanData.plan.forEach(day => {
                const dateStr = new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                
                // Count completed sessions for the day
                let dayCompleted = 0;
                day.sessions.forEach(session => {
                    if (completedSessions.includes(session.id)) dayCompleted++;
                });
                
                const isAllCompleted = day.sessions.length > 0 && dayCompleted === day.sessions.length;
                const statusColor = isAllCompleted ? 'var(--success)' : (dayCompleted > 0 ? 'var(--warning)' : 'var(--border-color)');
                
                const calendarCard = document.createElement('div');
                calendarCard.style.padding = '1rem';
                calendarCard.style.borderRadius = '0.5rem';
                calendarCard.style.border = `2px solid ${statusColor}`;
                calendarCard.style.backgroundColor = isAllCompleted ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-primary)';
                calendarCard.style.textAlign = 'center';
                calendarCard.style.cursor = 'pointer';
                calendarCard.title = 'Click to view full plan for this day';
                
                calendarCard.innerHTML = `
                    <div style="font-weight: 700; margin-bottom: 0.25rem;">Day ${day.dayNumber}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${dateStr}</div>
                    <div style="font-size: 0.85rem;">
                        <strong>${day.sessions.length}</strong> Sessions<br>
                        <strong>${day.hoursUsed}</strong> Hours
                    </div>
                `;
                
                calendarCard.addEventListener('click', () => {
                    window.location.href = 'plan.html';
                });
                
                calendarContainer.appendChild(calendarCard);
            });
        }
    };

    init();
});
