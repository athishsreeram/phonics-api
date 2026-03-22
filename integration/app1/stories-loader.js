/**
 * integration/app1/stories-loader.js
 *
 * Drop-in replacement for the hardcoded story in story.html.
 * Add <script src="js/config.js"></script> BEFORE this script.
 *
 * Usage in story.html — replace the hardcoded story block with:
 *
 *   <div id="story-container">Loading…</div>
 *   <script src="js/config.js"></script>
 *   <script src="js/stories-loader.js"></script>
 */

(function () {
  const BASE = window.PHONICS_API_BASE || 'https://phonics-api-k43i.onrender.com';

  // Read ?id=N from URL, default to story 1
  const params   = new URLSearchParams(window.location.search);
  const storyId  = params.get('id') || '1';
  const container = document.getElementById('story-container');

  async function loadStory() {
    if (!container) return;
    container.innerHTML = '<p>📖 Loading story…</p>';

    try {
      const res  = await fetch(`${BASE}/api/stories/${storyId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data: story } = await res.json();
      renderStory(story);
    } catch (err) {
      console.error('[stories-loader] fetch failed:', err);
      // Fallback to built-in hardcoded story
      container.innerHTML = `
        <p class="error">⚠️ Could not load story from server. Showing default.</p>
        <h2>The Cat and the Hat</h2>
        <p>The cat sat on the mat. The cat had a hat.</p>
      `;
    }
  }

  function renderStory(story) {
    // Highlight phonics words on click (tap-to-hear)
    const wordsSet = new Set((story.words || []).map(w => w.toLowerCase()));

    const markedContent = story.content.replace(/\b(\w+)\b/g, (word) => {
      const lower = word.toLowerCase();
      return wordsSet.has(lower)
        ? `<span class="phonics-word" data-word="${lower}">${word}</span>`
        : word;
    });

    container.innerHTML = `
      <div class="story-card">
        <div class="story-emoji">${story.emoji || '📖'}</div>
        <h2 class="story-title">${story.title}</h2>
        <p class="story-level">Level ${story.level}</p>
        <div class="story-body">${markedContent}</div>
        ${story.words && story.words.length ? `
          <div class="story-words">
            <strong>Key words:</strong>
            ${story.words.map(w => `<span class="word-chip">${w}</span>`).join(' ')}
          </div>` : ''}
      </div>
    `;

    // Tap-to-speak for highlighted words
    container.querySelectorAll('.phonics-word').forEach(el => {
      el.style.cssText = 'cursor:pointer;color:#e67e22;font-weight:bold;text-decoration:underline dotted;';
      el.addEventListener('click', () => {
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(el.dataset.word);
          u.rate = 0.8;
          speechSynthesis.speak(u);
        }
      });
    });
  }

  // Load story list for a "pick a story" UI
  async function loadStoryList(listContainerId) {
    const listEl = document.getElementById(listContainerId);
    if (!listEl) return;

    try {
      const res  = await fetch(`${BASE}/api/stories`);
      const { data: stories } = await res.json();

      listEl.innerHTML = stories.map(s => `
        <a href="story.html?id=${s.id}" class="story-link">
          <span>${s.emoji}</span>
          <span>${s.title}</span>
          <small>Level ${s.level}</small>
        </a>
      `).join('');
    } catch (err) {
      console.error('[stories-loader] list fetch failed:', err);
    }
  }

  // Auto-run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStory);
  } else {
    loadStory();
  }

  // Expose helpers globally for inline use
  window.PhonicsStories = { loadStory, loadStoryList };
})();
