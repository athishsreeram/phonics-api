/**
 * ─────────────────────────────────────────────────────────────
 * APP 2 INTEGRATION — phonics-admin
 * Add this as js/stories.js in the admin dashboard.
 * Requires: window.PHONICS_API_BASE and window.adminToken set
 * after login.
 * ─────────────────────────────────────────────────────────────
 */

const StoriesAPI = (() => {
  function getBase()  { return window.PHONICS_API_BASE || 'https://phonics-api-k43i.onrender.com'; }
  function getToken() { return window.adminToken || localStorage.getItem('admin_token') || ''; }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    };
  }

  // ── READ ──────────────────────────────────────────────────
  async function getAll() {
    const res = await fetch(`${getBase()}/api/stories`);
    if (!res.ok) throw new Error(`GET /api/stories failed: ${res.status}`);
    const { data } = await res.json();
    return data;
  }

  async function getOne(id) {
    const res = await fetch(`${getBase()}/api/stories/${id}`);
    if (!res.ok) throw new Error(`GET /api/stories/${id} failed: ${res.status}`);
    const { data } = await res.json();
    return data;
  }

  // ── CREATE ────────────────────────────────────────────────
  async function create({ title, content, level = 1, emoji = '📖', words = [] }) {
    if (!title || !content) throw new Error('title and content are required');

    const res = await fetch(`${getBase()}/api/stories`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, content, level, emoji, words }),
    });

    if (res.status === 401) throw new Error('Not authenticated — please log in again');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Create failed: ${res.status}`);
    }

    const { data } = await res.json();
    return data;
  }

  // ── UPDATE ────────────────────────────────────────────────
  async function update(id, fields) {
    const res = await fetch(`${getBase()}/api/stories/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(fields),
    });

    if (res.status === 401) throw new Error('Not authenticated — please log in again');
    if (res.status === 404) throw new Error(`Story ${id} not found`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Update failed: ${res.status}`);
    }

    const { data } = await res.json();
    return data;
  }

  // ── DELETE ────────────────────────────────────────────────
  async function remove(id) {
    const res = await fetch(`${getBase()}/api/stories/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (res.status === 401) throw new Error('Not authenticated — please log in again');
    if (res.status === 404) throw new Error(`Story ${id} not found`);
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);

    return true;
  }

  return { getAll, getOne, create, update, remove };
})();


/**
 * ─────────────────────────────────────────────────────────────
 * Example: Render stories table in admin UI
 * Call this after the admin has logged in and token is set.
 * ─────────────────────────────────────────────────────────────
 */
async function renderStoriesTable(containerId = 'stories-table') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<p>Loading stories…</p>';

  try {
    const stories = await StoriesAPI.getAll();

    if (!stories.length) {
      container.innerHTML = '<p>No stories yet. Create one below.</p>';
      return;
    }

    const rows = stories.map(s => `
      <tr data-id="${s.id}">
        <td>${s.id}</td>
        <td>${s.emoji}</td>
        <td>${s.title}</td>
        <td>${s.level}</td>
        <td>${s.words?.join(', ') || '—'}</td>
        <td>${s.active ? '✅' : '❌'}</td>
        <td>
          <button onclick="editStory(${s.id})">Edit</button>
          <button onclick="deleteStory(${s.id})" style="color:red">Delete</button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Emoji</th><th>Title</th>
            <th>Level</th><th>Words</th><th>Active</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
  }
}

async function deleteStory(id) {
  if (!confirm(`Delete story ${id}?`)) return;
  try {
    await StoriesAPI.remove(id);
    renderStoriesTable(); // refresh
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}

async function editStory(id) {
  const story = await StoriesAPI.getOne(id);
  // Populate your modal/form with story fields, then call:
  // StoriesAPI.update(id, { title, content, level, emoji, words })
  console.log('Edit story:', story);
  alert(`Edit story ${id}: "${story.title}" — wire this to your modal`);
}

// Handle create form submission
async function handleCreateStory(formData) {
  try {
    const story = await StoriesAPI.create({
      title:   formData.title,
      content: formData.content,
      level:   parseInt(formData.level) || 1,
      emoji:   formData.emoji || '📖',
      words:   formData.words?.split(',').map(w => w.trim()).filter(Boolean) || [],
    });
    console.log('Created:', story);
    renderStoriesTable(); // refresh table
    return story;
  } catch (err) {
    alert(`Failed to create story: ${err.message}`);
    throw err;
  }
}
