/**
 * integration/app2/stories-admin.js
 *
 * Drop-in JS for phonics-admin to manage stories via API.
 * Requires: window.PHONICS_API_BASE and a valid JWT in localStorage.
 *
 * Usage: <script src="js/stories-admin.js"></script>
 *
 * Expected HTML structure (add to your admin dashboard):
 *
 *   <section id="stories-section">
 *     <h2>Stories</h2>
 *     <button onclick="StoriesAdmin.showCreateForm()">+ New Story</button>
 *     <div id="stories-form" style="display:none"></div>
 *     <div id="stories-list"></div>
 *   </section>
 */

const StoriesAdmin = (() => {
  const BASE = () => window.PHONICS_API_BASE || 'https://phonics-api-k43i.onrender.com';
  const TOKEN = () => localStorage.getItem('phonics_admin_token') || '';

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN()}`,
    };
  }

  // ─── FETCH ALL ────────────────────────────────────────────────────────────
  async function loadAll() {
    const listEl = document.getElementById('stories-list');
    if (listEl) listEl.innerHTML = '<p>Loading…</p>';

    const res  = await fetch(`${BASE()}/api/stories`);
    const { data: stories } = await res.json();

    if (!listEl) return stories;

    listEl.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>Emoji</th><th>Title</th><th>Level</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${stories.map(s => `
            <tr data-id="${s.id}">
              <td>${s.id}</td>
              <td>${s.emoji}</td>
              <td>${s.title}</td>
              <td>${s.level}</td>
              <td>${s.active ? '✅' : '❌'}</td>
              <td>
                <button onclick="StoriesAdmin.showEditForm(${s.id})">Edit</button>
                <button onclick="StoriesAdmin.deleteStory(${s.id})" style="color:red">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    return stories;
  }

  // ─── CREATE ───────────────────────────────────────────────────────────────
  function showCreateForm() {
    const formEl = document.getElementById('stories-form');
    if (!formEl) return;
    formEl.style.display = 'block';
    formEl.innerHTML = buildForm({});
  }

  async function createStory(payload) {
    const res  = await fetch(`${BASE()}/api/stories`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Create failed');
    await loadAll();
    return data.data;
  }

  // ─── READ ONE ─────────────────────────────────────────────────────────────
  async function getStory(id) {
    const res  = await fetch(`${BASE()}/api/stories/${id}`);
    const { data } = await res.json();
    return data;
  }

  // ─── EDIT / UPDATE ────────────────────────────────────────────────────────
  async function showEditForm(id) {
    const story  = await getStory(id);
    const formEl = document.getElementById('stories-form');
    if (!formEl) return;
    formEl.style.display = 'block';
    formEl.innerHTML = buildForm(story, id);
  }

  async function updateStory(id, payload) {
    const res  = await fetch(`${BASE()}/api/stories/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Update failed');
    await loadAll();
    return data.data;
  }

  // ─── DELETE ───────────────────────────────────────────────────────────────
  async function deleteStory(id) {
    if (!confirm(`Delete story #${id}?`)) return;
    const res  = await fetch(`${BASE()}/api/stories/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Delete failed');
    await loadAll();
  }

  // ─── FORM BUILDER ─────────────────────────────────────────────────────────
  function buildForm(story = {}, id = null) {
    const isEdit = id !== null;
    return `
      <form onsubmit="StoriesAdmin.handleSubmit(event, ${id})" style="background:#f9f9f9;padding:16px;border-radius:8px;margin-bottom:16px">
        <h3>${isEdit ? `Edit Story #${id}` : 'New Story'}</h3>
        <label>Title <input name="title" value="${story.title || ''}" required style="display:block;width:100%;margin:4px 0 12px"></label>
        <label>Emoji <input name="emoji" value="${story.emoji || '📖'}" style="display:block;width:80px;margin:4px 0 12px"></label>
        <label>Level
          <select name="level" style="display:block;margin:4px 0 12px">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${story.level == n ? 'selected' : ''}>Level ${n}</option>`).join('')}
          </select>
        </label>
        <label>Content
          <textarea name="content" rows="4" required style="display:block;width:100%;margin:4px 0 12px">${story.content || ''}</textarea>
        </label>
        <label>Phonics words (comma-separated)
          <input name="words" value="${(story.words || []).join(', ')}" style="display:block;width:100%;margin:4px 0 12px">
        </label>
        ${isEdit ? `<label><input type="checkbox" name="active" ${story.active ? 'checked' : ''}> Active</label><br>` : ''}
        <button type="submit" style="margin-top:8px">${isEdit ? 'Save Changes' : 'Create Story'}</button>
        <button type="button" onclick="StoriesAdmin.hideForm()" style="margin-left:8px">Cancel</button>
      </form>
    `;
  }

  async function handleSubmit(event, id) {
    event.preventDefault();
    const form = event.target;
    const wordsRaw = form.words.value;
    const payload = {
      title:   form.title.value.trim(),
      emoji:   form.emoji.value.trim(),
      level:   parseInt(form.level.value),
      content: form.content.value.trim(),
      words:   wordsRaw ? wordsRaw.split(',').map(w => w.trim()).filter(Boolean) : [],
      ...(id !== null && { active: form.active ? form.active.checked : true }),
    };

    try {
      if (id !== null) {
        await updateStory(id, payload);
        alert('Story updated!');
      } else {
        await createStory(payload);
        alert('Story created!');
      }
      hideForm();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  function hideForm() {
    const formEl = document.getElementById('stories-form');
    if (formEl) { formEl.style.display = 'none'; formEl.innerHTML = ''; }
  }

  // Auto-load on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('stories-list')) loadAll();
  });

  return { loadAll, showCreateForm, showEditForm, createStory, updateStory, deleteStory, handleSubmit, hideForm, getStory };
})();
