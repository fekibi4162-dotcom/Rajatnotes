const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.DATA_DIR = path.join(os.tmpdir(), `rajatnotes-test-${Date.now()}`);
process.env.JWT_SECRET = 'test-secret';
const app = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
});

test('users can sign up, log in, and manage private notes', async () => {
  const signup = await post('/api/signup', { name: 'Rajat', email: 'rajat@example.com', password: 'password123' });
  assert.equal(signup.user.email, 'rajat@example.com');

  const created = await post('/api/notes', { title: 'First note', content: 'Synced everywhere' }, signup.token);
  assert.equal(created.note.title, 'First note');

  const listed = await get('/api/notes', signup.token);
  assert.equal(listed.notes.length, 1);

  const login = await post('/api/login', { email: 'rajat@example.com', password: 'password123' });
  const updated = await put(`/api/notes/${created.note.id}`, { title: 'Updated', content: 'Still private' }, login.token);
  assert.equal(updated.note.content, 'Still private');
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

function get(pathname, token) {
  return request(pathname, { headers: { Authorization: `Bearer ${token}` } });
}

function post(pathname, body, token) {
  return request(pathname, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
}

function put(pathname, body, token) {
  return request(pathname, { method: 'PUT', headers: headers(token), body: JSON.stringify(body) });
}

function headers(token) {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
