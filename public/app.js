const state = { mode: 'login', user: null, token: localStorage.getItem('token'), notes: [] };

const authSection = document.querySelector('#auth');
const appSection = document.querySelector('#app');
const authForm = document.querySelector('#auth-form');
const noteForm = document.querySelector('#note-form');
const notesEl = document.querySelector('#notes');
const messageEl = document.querySelector('#auth-message');
const searchEl = document.querySelector('#search');

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Something went wrong.');
  return response.status === 204 ? null : response.json();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  document.querySelector('.signup-only').classList.toggle('hidden', mode !== 'signup');
  authForm.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  messageEl.textContent = '';
}

function renderShell() {
  authSection.classList.toggle('hidden', Boolean(state.token));
  appSection.classList.toggle('hidden', !state.token);
  if (state.user) document.querySelector('#welcome').textContent = `${state.user.name}'s notes`;
}

function renderNotes() {
  const query = searchEl.value.toLowerCase();
  const visibleNotes = state.notes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(query));
  notesEl.innerHTML = visibleNotes.length ? '' : '<p>No notes yet. Save your first note above.</p>';

  visibleNotes.forEach((note) => {
    const article = document.createElement('article');
    article.className = 'card note';
    article.innerHTML = `
      <h3>${escapeHtml(note.title || 'Untitled note')}</h3>
      <p>${escapeHtml(note.content).replaceAll('\n', '<br>')}</p>
      <small>Updated ${new Date(note.updatedAt).toLocaleString()}</small>
      <div class="note-actions">
        <button class="ghost" data-edit="${note.id}">Edit</button>
        <button class="ghost" data-delete="${note.id}">Delete</button>
      </div>`;
    notesEl.append(article);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function loadNotes() {
  const data = await api('/api/notes');
  state.notes = data.notes;
  renderNotes();
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
searchEl.addEventListener('input', renderNotes);

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  try {
    const data = await api(`/api/${state.mode}`, {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.user = data.user;
    state.token = data.token;
    localStorage.setItem('token', state.token);
    renderShell();
    await loadNotes();
  } catch (error) {
    messageEl.textContent = error.message;
  }
});

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(noteForm).entries());
  await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
  noteForm.reset();
  await loadNotes();
});

notesEl.addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    await api(`/api/notes/${deleteId}`, { method: 'DELETE' });
    await loadNotes();
  }
  if (editId) {
    const note = state.notes.find((entry) => entry.id === editId);
    const title = prompt('Update title', note.title) ?? note.title;
    const content = prompt('Update note', note.content) ?? note.content;
    await api(`/api/notes/${editId}`, { method: 'PUT', body: JSON.stringify({ title, content }) });
    await loadNotes();
  }
});

document.querySelector('#logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  Object.assign(state, { token: null, user: null, notes: [] });
  renderShell();
});

if (state.token) loadNotes().catch(() => document.querySelector('#logout').click());
renderShell();
