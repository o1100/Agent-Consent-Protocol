// ========== Nav scroll effect ==========
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
});

// ========== Mobile menu ==========
const hamburger = document.querySelector('.nav-hamburger');
const navLinks = document.querySelector('.nav-links');
if (hamburger) {
  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    hamburger.classList.toggle('active');
  });
  // Close on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('active');
    });
  });
}

// ========== Copy to clipboard ==========
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const el = document.getElementById(target);
    if (!el) return;

    const text = el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('copied');
      }, 2000);
    });
  });
});

// ========== Prompt tabs ==========
document.querySelectorAll('.prompt-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const group = tab.dataset.group;
    // Deactivate siblings
    document.querySelectorAll(`.prompt-tab[data-group="${group}"]`).forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Show matching content
    const target = tab.dataset.target;
    document.querySelectorAll(`.prompt-content[data-group="${group}"]`).forEach(c => {
      c.style.display = 'none';
    });
    document.getElementById(target).style.display = 'block';
    // Update copy button target
    const copyBtn = document.querySelector(`.copy-btn[data-group="${group}"]`);
    if (copyBtn) copyBtn.dataset.target = target + '-text';
  });
});

// ========== Intersection Observer for fade-in ==========
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// ========== Terminal typing effect ==========
function typeTerminal() {
  const lines = document.querySelectorAll('.terminal-line');
  lines.forEach((line, i) => {
    line.style.opacity = '0';
    setTimeout(() => {
      line.style.transition = 'opacity 0.4s ease';
      line.style.opacity = '1';
    }, i * 600 + 300);
  });
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', typeTerminal);
} else {
  typeTerminal();
}
