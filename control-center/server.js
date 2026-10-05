const express = require('express');
const path = require('path');
const auth = require('./lib/auth');
const runner = require('./lib/runner');

const PORT = parseInt(process.env.PORT || '9877', 10);
const VIEWS = path.join(__dirname, 'views');

const app = express();
// Number of reverse proxies in front (for req.ip / req.secure); 0 when exposed directly.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '0', 10));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Pages: `admin` pages redirect non-admins to the runner.
const PAGES = [
  { route: '/', file: 'runner.html' },
  { route: '/coverage', file: 'coverage.html' },
  { route: '/dashboard', file: 'dashboard.html', admin: true },
  { route: '/users', file: 'users.html', admin: true },
];

PAGES.forEach(({ route, file, admin }) => {
  app.get(route, (req, res) => {
    const user = auth.getUserFromRequest(req);
    if (!user) return res.redirect('/login');
    if (admin && user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(VIEWS, file));
  });
});

app.get('/login', (req, res) => res.sendFile(path.join(VIEWS, 'login.html')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));

// Everything below requires a session.
app.use('/api', auth.requireAuth);
app.use('/api/users', require('./routes/users'));
app.use('/api/usage', require('./routes/usage'));
app.use('/api/coverage', require('./routes/coverage'));
app.use('/api', require('./routes/project'));
app.use('/api', require('./routes/runs'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`[Control Center] Listening on http://localhost:${PORT}`));

const shutdown = () => {
  runner.shutdown();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
