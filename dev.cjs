/* personal-website launcher: free port 5173, run Vite on it, open the tab.
 *
 *   npm run dev        start (killing a stale dev server first), open Chrome
 *   npm run stop       stop it and close the site's Chrome tab
 *   npm run restart    same as dev
 *
 * Why this exists rather than just `vite`: when a dev server from an earlier
 * session is still running, Vite does NOT fail - it prints "Port 5173 is in
 * use, trying another one" and quietly moves to 5174, 5175, ... So the URL
 * changes between sessions, an open tab points at a server that no longer
 * exists, and HMR silently stops arriving. One had been running here for over
 * a day. This frees the port first and passes --strictPort, so the address is
 * always http://localhost:5173 or you get a real error.
 *
 * Twin of pyprep/dev.js in the pyprep:autoapply repo; kept as a separate copy
 * because these are separate repos and a shared file neither owns is worse.
 *
 * Add -- --no-open / -- --no-close (or set DEV_OPEN=0) to leave the browser
 * alone - restarting while you already have the tab open, for instance.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PORT = 5173;
const VITE = path.join(__dirname, 'node_modules', '.bin', 'vite');
const BROWSER_ENV = 'DEV_OPEN';
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* fine */ } };

/** PIDs listening on PORT (v4 or v6), or [] if lsof is unavailable. */
function listeners() {
  const r = spawnSync('lsof', ['-ti', `:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (r.error) return [];
  return [...new Set((r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).map(Number))];
}

/** The FULL command line behind a pid, e.g. "node /path/vite --port 5173". */
function commandOf(pid) {
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

/* Is this pid THIS project's dev server, rather than merely some node process?
 * Matching on the absolute path of this project's own vite binary means a Vite
 * belonging to a different project, or any other server that happens to be on
 * 5173, is left alone instead of being killed out from under you. */
function isOurServer(cmd) {
  return cmd.includes(VITE);
}

/** Returns true if the port ended up free. Only ever kills THIS project's server. */
function freePort() {
  const pids = listeners();
  if (!pids.length) return true;

  for (const pid of pids) {
    const cmd = commandOf(pid);
    if (!isOurServer(cmd)) {
      console.error(`Port ${PORT} is held by pid ${pid}, which is not this project's dev server:`);
      console.error(`  ${cmd || '(unknown process)'}`);
      console.error('Refusing to kill it. Stop that program yourself, or free the port with:');
      console.error(`  kill ${pid}`);
      return false;
    }
    try { process.kill(pid, 'SIGTERM'); console.log(`stopped this project's old dev server (pid ${pid})`); }
    catch (e) { if (e.code !== 'ESRCH') { console.error(`could not stop pid ${pid}: ${e.message}`); return false; } }
  }

  for (let i = 0; i < 30; i++) { sleep(100); if (!listeners().length) return true; }
  for (const pid of listeners()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  sleep(300);
  if (listeners().length) { console.error(`Port ${PORT} is still in use. Run: lsof -nP -iTCP:${PORT} -sTCP:LISTEN`); return false; }
  return true;
}

/** Open in Chrome, falling back to the default browser. Detached: closing the
 *  terminal must not close the tab. */
function openBrowser(url) {
  const tries = process.platform === 'darwin'
    ? [['open', ['-a', 'Google Chrome', url]], ['open', [url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', 'chrome', url]], ['cmd', ['/c', 'start', '', url]]]
      : [['google-chrome', [url]], ['xdg-open', [url]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    if (!r.error && r.status === 0) return true;
  }
  console.log(`(could not open a browser automatically - go to ${url})`);
  return false;
}

/* Close the site's tabs. Guarded by "if it is running" so stopping the server
 * never LAUNCHES Chrome just to close a tab in it. macOS only; elsewhere a
 * no-op rather than a broken promise. */
function closeTabs() {
  if (process.platform !== 'darwin') return 0;
  const match = `(URL contains "localhost:${PORT}" or URL contains "127.0.0.1:${PORT}")`;
  const script = `
    if application "Google Chrome" is running then
      tell application "Google Chrome"
        set n to count (tabs of every window whose ${match})
        close (every tab of every window whose ${match})
        return n
      end tell
    else
      return 0
    end if`;
  const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 0;
  return Number((r.stdout || '0').trim()) || 0;
}

/** Poll until the server answers, so the tab never opens onto a dead port.
 *  Uses "localhost" rather than 127.0.0.1 because Vite binds ::1 (IPv6). */
function waitForServer(timeoutMs = 20000) {
  const http = require('http');
  const started = Date.now();
  return new Promise(resolve => {
    const attempt = () => {
      const req = http.get({ host: 'localhost', port: PORT, path: '/', timeout: 500 }, res => { res.resume(); resolve(true); });
      req.on('error', () => { Date.now() - started > timeoutMs ? resolve(false) : setTimeout(attempt, 200); });
      req.on('timeout', () => req.destroy());
    };
    attempt();
  });
}

// Flags and command in any order - `npm run dev -- --no-open` puts the flag in
// argv[2], so the mode is the first NON-flag argument.
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('-'));
const mode = (argv.find(a => !a.startsWith('-')) || 'start').toLowerCase();
const browserOk = process.env[BROWSER_ENV] !== '0' && !flags.includes('--no-open') && !flags.includes('--no-close');

if (mode === 'stop') {
  if (!listeners().length) console.log(`nothing was running on ${PORT}`);
  const ok = freePort();
  if (browserOk) {
    const n = closeTabs();
    if (n) console.log(`closed ${n} tab${n === 1 ? '' : 's'} in Chrome`);
  }
  process.exit(ok ? 0 : 1);
}

if (!['start', 'restart', 'dev'].includes(mode)) {
  console.error(`unknown command "${mode}" - use: start | stop | restart`);
  process.exit(1);
}

if (!freePort()) process.exit(1);

// --strictPort: having freed 5173, fail loudly rather than drifting to 5174.
// Any extra flags are forwarded, so `npm run dev -- --host` still works.
const passthrough = argv.filter(a => a !== '--no-open' && a !== '--no-close' && a !== mode);
const child = spawn(VITE, ['--port', String(PORT), '--strictPort', ...passthrough], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on('error', err => { console.error(`could not start vite: ${err.message}`); process.exit(1); });

if (browserOk) {
  waitForServer().then(up => {
    if (up) openBrowser(`http://localhost:${PORT}`);
    else console.log(`(server did not answer in time - open http://localhost:${PORT} yourself)`);
  });
}
