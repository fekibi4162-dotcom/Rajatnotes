const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-before-deploying';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

async function readDb() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { users: [], notes: [] }; throw error; }
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashPassword(password, salt).split(':')[1], 'hex'));
}

function publicUser(user) { return { id: user.id, name: user.name, email: user.email }; }

function signToken(user) {
  const payload = Buffer.from(JSON.stringify(publicUser(user))).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireUser(req, res) {
  const user = verifyToken(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) send(res, 401, { error: 'Authentication required.' });
  return user;
}

async function handleApi(req, res, url) {
  const body = ['POST', 'PUT'].includes(req.method) ? await parseBody(req) : {};

  if (req.method === 'POST' && url.pathname === '/api/signup') {
    const { name, email, password } = body;
    if (!name || !email || !password) return send(res, 400, { error: 'Name, email, and password are required.' });
    if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    const db = await readDb();
    const normalizedEmail = email.toLowerCase().trim();
    if (db.users.some((user) => user.email === normalizedEmail)) return send(res, 409, { error: 'An account with this email already exists.' });
    const user = { id: crypto.randomUUID(), name: name.trim(), email: normalizedEmail, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    db.users.push(user);
    await writeDb(db);
    return send(res, 201, { user: publicUser(user), token: signToken(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const db = await readDb();
    const user = db.users.find((entry) => entry.email === String(body.email || '').toLowerCase().trim());
    if (!user || !verifyPassword(body.password || '', user.passwordHash)) return send(res, 401, { error: 'Invalid email or password.' });
    return send(res, 200, { user: publicUser(user), token: signToken(user) });
  }

  const authedUser = requireUser(req, res);
  if (!authedUser) return;
  const db = await readDb();

  if (req.method === 'GET' && url.pathname === '/api/notes') {
    const notes = db.notes.filter((note) => note.userId === authedUser.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return send(res, 200, { notes });
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    if (!title && !content) return send(res, 400, { error: 'Write a title or note content first.' });
    const now = new Date().toISOString();
    const note = { id: crypto.randomUUID(), userId: authedUser.id, title, content, createdAt: now, updatedAt: now };
    db.notes.push(note);
    await writeDb(db);
    return send(res, 201, { note });
  }

  const noteId = url.pathname.match(/^\/api\/notes\/([^/]+)$/)?.[1];
  if (noteId && req.method === 'PUT') {
    const note = db.notes.find((entry) => entry.id === noteId && entry.userId === authedUser.id);
    if (!note) return send(res, 404, { error: 'Note not found.' });
    note.title = String(body.title || '').trim();
    note.content = String(body.content || '').trim();
    note.updatedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { note });
  }

  if (noteId && req.method === 'DELETE') {
    const originalCount = db.notes.length;
    db.notes = db.notes.filter((entry) => !(entry.id === noteId && entry.userId === authedUser.id));
    if (db.notes.length === originalCount) return send(res, 404, { error: 'Note not found.' });
    await writeDb(db);
    res.writeHead(204).end();
    return;
  }

  send(res, 404, { error: 'Not found.' });
}

async function serveStatic(req, res, url) {
  const filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  try {
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(await fs.readFile(filePath));
  } catch { res.writeHead(404).end('Not found'); }
}

const app = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  (url.pathname.startsWith('/api/') ? handleApi(req, res, url) : serveStatic(req, res, url)).catch((error) => send(res, 500, { error: error.message }));
});

if (require.main === module) app.listen(PORT, () => console.log(`Rajatnotes running on http://localhost:${PORT}`));
module.exports = app;
