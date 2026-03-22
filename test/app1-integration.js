/**
 * ─────────────────────────────────────────────────────────────
 * APP 1 INTEGRATION — phonics77-app
 * File to create: js/config.js  (already referenced in README)
 * ─────────────────────────────────────────────────────────────
 */

// js/config.js
// Set this once; all other files reference window.PHONICS_API_BASE
window.PHONICS_API_BASE = 'https://phonics-api-k43i.onrender.com';


/**
 * ─────────────────────────────────────────────────────────────
 * story.html — replace the hardcoded story with API data
 * Drop this into the <script> block of story.html
 * ─────────────────────────────────────────────────────────────
 */

// story.html <script> replacement
(async function loadStories() {
  const API = window.PHONICS_API_BASE || 'https://phonics-api-k43i.onrender.com';

  // Show loading state
  const container = document.getElementById('story-container');
  if (container) container.innerHTML = '<p>Loading stories…</p>';

  try {
    const res  = await fetch(`${API}/api/stories`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const { data: stories } = await res.json();

    if (!stories.length) {
      container.innerHTML = '<p>No stories available yet.</p>';
      return;
    }

    // Render first story (or build a picker)
    const story = stories[0];
    renderStory(story);

    // Log analytics event (fire-and-forget)
    fetch(`${API}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'story_view',
        session: sessionStorage.getItem('sid') || 'anon',
        url: window.location.pathname,
        ua: window.innerWidth > 768 ? 'desktop' : 'mobile',
        premium: !!localStorage.getItem('premium_token'),
        ts: Date.now(),
        data: { story_id: story.id, story_title: story.title },
      }),
    }).catch(() => {}); // fire-and-forget, never block UI

  } catch (err) {
    console.error('Failed to load stories:', err);
    if (container) {
      container.innerHTML = `
        <p>Could not load stories right now.</p>
        <small>${err.message}</small>`;
    }
  }

  function renderStory(story) {
    document.getElementById('story-emoji').textContent  = story.emoji || '📖';
    document.getElementById('story-title').textContent  = story.title;
    document.getElementById('story-content').textContent = story.content;

    // Optionally highlight phonics words
    if (story.words?.length) {
      let html = story.content;
      story.words.forEach(word => {
        const re = new RegExp(`\\b(${word})\\b`, 'gi');
        html = html.replace(re, '<span class="phonics-word" onclick="speakWord(\'$1\')">$1</span>');
      });
      document.getElementById('story-content').innerHTML = html;
    }
  }
})();

// Speak a word using Web Speech API
function speakWord(word) {
  if (!window.speechSynthesis) return;
  const utt = new SpeechSynthesisUtterance(word);
  utt.rate = 0.8;
  speechSynthesis.speak(utt);
}
