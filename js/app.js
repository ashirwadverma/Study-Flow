/**
 * app.js
 * Contains shared UI logic for all pages
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Navigation Toggle ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.getElementById('nav-links');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('show');
            const isExpanded = navLinks.classList.contains('show');
            mobileMenuBtn.innerHTML = isExpanded ? '✕' : '☰';
        });
    }

    // --- Active Link Highlight ---
    const currentPath = window.location.pathname;
    const links = document.querySelectorAll('.nav-links a');
    
    links.forEach(link => {
        const linkPath = link.getAttribute('href');
        // Simple logic to match current page to link href
        if (linkPath && currentPath.endsWith(linkPath.replace('./', ''))) {
            link.classList.add('active');
        } else if (currentPath.endsWith('/') && linkPath === 'index.html') {
            // Root path default to index
            link.classList.add('active');
        }
    });

});

/**
 * Global utility to show a toast message
 * @param {string} message - Text to show
 * @param {string} type - 'success', 'error', 'info'
 */
window.showToast = function(message, type = 'info') {
    // Remove existing toast if any
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '1rem 1.5rem';
    toast.style.borderRadius = '0.5rem';
    toast.style.color = '#fff';
    toast.style.fontWeight = '500';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.2)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s ease';

    if (type === 'success') toast.style.backgroundColor = 'var(--success)';
    else if (type === 'error') toast.style.backgroundColor = 'var(--danger)';
    else toast.style.backgroundColor = 'var(--text-secondary)';

    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

/**
 * Global Modal Utility
 */
window.showModal = function(title, contentHtml) {
    let overlay = document.getElementById('global-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'global-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2 id="global-modal-title" style="font-size: 1.25rem; margin: 0;"></h2>
                    <button class="modal-close" id="global-modal-close">&times;</button>
                </div>
                <div id="global-modal-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('global-modal-close').addEventListener('click', () => {
            window.hideModal();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) window.hideModal();
        });
    }

    document.getElementById('global-modal-title').textContent = title;
    document.getElementById('global-modal-body').innerHTML = contentHtml;
    
    // Add show class
    setTimeout(() => overlay.classList.add('show'), 10);
};

window.hideModal = function() {
    const overlay = document.getElementById('global-modal');
    if (overlay) {
        overlay.classList.remove('show');
    }
};
