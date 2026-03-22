/**
 * controllers/stories.js
 * Full CRUD for phonics stories.
 * Works with PostgreSQL or in-memory fallback.
 */

const { query, useMemory, memDB, getMemNextId } = require('../db/init');

// GET /api/stories
async function getAll(req, res) {
  try {
    if (useMemory()) {
      const stories = memDB.stories.filter(s => s.active !== false);
      return res.json({ ok: true, data: stories, source: 'memory' });
    }

    const { rows } = await query(
      `SELECT id, title, level, emoji, content, words, active, created_at, updated_at
       FROM stories
       WHERE active = TRUE
       ORDER BY level ASC, id ASC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[stories.getAll]', err.message);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
}

// GET /api/stories/:id
async function getOne(req, res) {
  const id = parseInt(req.params.id);
  try {
    if (useMemory()) {
      const story = memDB.stories.find(s => s.id === id);
      if (!story) return res.status(404).json({ error: 'Story not found' });
      return res.json({ ok: true, data: story, source: 'memory' });
    }

    const { rows } = await query('SELECT * FROM stories WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Story not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[stories.getOne]', err.message);
    res.status(500).json({ error: 'Failed to fetch story' });
  }
}

// POST /api/stories
async function create(req, res) {
  const { title, content, level = 1, emoji = '📖', words = [] } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  try {
    if (useMemory()) {
      const story = {
        id: getMemNextId('stories'),
        title, content, level, emoji,
        words: Array.isArray(words) ? words : [],
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memDB.stories.push(story);
      return res.status(201).json({ ok: true, data: story, source: 'memory' });
    }

    const { rows } = await query(
      `INSERT INTO stories (title, content, level, emoji, words)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, content, level, emoji, words]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[stories.create]', err.message);
    res.status(500).json({ error: 'Failed to create story' });
  }
}

// PUT /api/stories/:id
async function update(req, res) {
  const id = parseInt(req.params.id);
  const { title, content, level, emoji, words, active } = req.body;

  try {
    if (useMemory()) {
      const idx = memDB.stories.findIndex(s => s.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Story not found' });

      const existing = memDB.stories[idx];
      const updated = {
        ...existing,
        ...(title   !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(level   !== undefined && { level }),
        ...(emoji   !== undefined && { emoji }),
        ...(words   !== undefined && { words }),
        ...(active  !== undefined && { active }),
        updated_at: new Date().toISOString(),
      };
      memDB.stories[idx] = updated;
      return res.json({ ok: true, data: updated, source: 'memory' });
    }

    const setClauses = [];
    const values = [];
    let i = 1;

    if (title   !== undefined) { setClauses.push(`title = $${i++}`);   values.push(title); }
    if (content !== undefined) { setClauses.push(`content = $${i++}`); values.push(content); }
    if (level   !== undefined) { setClauses.push(`level = $${i++}`);   values.push(level); }
    if (emoji   !== undefined) { setClauses.push(`emoji = $${i++}`);   values.push(emoji); }
    if (words   !== undefined) { setClauses.push(`words = $${i++}`);   values.push(words); }
    if (active  !== undefined) { setClauses.push(`active = $${i++}`);  values.push(active); }

    if (!setClauses.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await query(
      `UPDATE stories SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Story not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[stories.update]', err.message);
    res.status(500).json({ error: 'Failed to update story' });
  }
}

// DELETE /api/stories/:id
async function remove(req, res) {
  const id = parseInt(req.params.id);

  try {
    if (useMemory()) {
      const idx = memDB.stories.findIndex(s => s.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Story not found' });
      memDB.stories.splice(idx, 1);
      return res.json({ ok: true, message: `Story ${id} deleted`, source: 'memory' });
    }

    const { rowCount } = await query('DELETE FROM stories WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Story not found' });
    res.json({ ok: true, message: `Story ${id} deleted` });
  } catch (err) {
    console.error('[stories.delete]', err.message);
    res.status(500).json({ error: 'Failed to delete story' });
  }
}

module.exports = { getAll, getOne, create, update, remove };
