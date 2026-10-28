/**
 * theme.js
 * Handles light and dark mode toggling and persistence
 */

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;

    // Load saved theme or check system preference
    const loadTheme = () => {
        let savedTheme = localStorage.getItem('ssp_theme');
        if (!savedTheme) {
            // Check system preference
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            savedTheme = prefersDark ? 'dark' : 'light';
        }
        
        setTheme(savedTheme);
    };

    const setTheme = (theme) => {
        htmlElement.setAttribute('data-theme', theme);
        localStorage.setItem('ssp_theme', theme);
        updateToggleButton(theme);
    };

    const updateToggleButton = (theme) => {
        if (!themeToggleBtn) return;
        
        if (theme === 'dark') {
            themeToggleBtn.innerHTML = '☀️'; // Sun icon for light mode switch
            themeToggleBtn.setAttribute('aria-label', 'Switch to light mode');
        } else {
            themeToggleBtn.innerHTML = '🌙'; // Moon icon for dark mode switch
            themeToggleBtn.setAttribute('aria-label', 'Switch to dark mode');
        }
    };

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            setTheme(newTheme);
        });
    }

    // Initialize
    loadTheme();
});
