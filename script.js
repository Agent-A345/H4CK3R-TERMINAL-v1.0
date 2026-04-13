/* =========================================================
   HACK TERMINAL v1.0 — script.js
   Pure vanilla JS. No libraries.
   ========================================================= */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────────── */
const MAX_HISTORY   = 100;
const STORAGE_KEY   = 'h4ck_cmd_history';
const TYPING_SPEED  = 18;   // ms per character
const BOOT_LINES = [
  { t: 'ok',  m: 'Initializing kernel modules...' },
  { t: 'ok',  m: 'Loading BIOS shadow memory (64K)...' },
  { t: 'ok',  m: 'Mounting /dev/sda1 on / ...' },
  { t: 'err', m: 'WARNING: Deprecated API detected (ignoring)' },
  { t: 'ok',  m: 'Starting network daemon: eth0 [192.168.0.1]' },
  { t: 'ok',  m: 'Establishing encrypted tunnel... done' },
  { t: 'ok',  m: 'Bypassing firewall ruleset #7...' },
  { t: 'err', m: 'WARNING: Intrusion detection system tripped' },
  { t: 'ok',  m: 'Routing through proxy chain [TOR]...' },
  { t: 'ok',  m: 'Spoofing MAC address: 00:1A:2B:3C:4D:5E' },
  { t: 'ok',  m: 'All systems nominal. Shell ready.' },
];

/* ── STATE ─────────────────────────────────────────────── */
let cmdHistory    = [];    // persisted
let historyIdx    = -1;    // navigation index
let isRootMode    = false;
let isTyping      = false; // prevent overlap
let suggestIdx    = -1;
let loginPending  = false; // waiting for password
let matrixActive  = false;
let matrixFull    = false;
let audioCtx      = null;
let muteSound     = false;

/* ── DOM REFS ──────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const bootScreen  = $('boot-screen');
const bootBar     = $('boot-bar');
const bootLog     = $('boot-log');
const terminal    = $('terminal');
const output      = $('output');
const cmdInput    = $('cmd-input');
const promptLabel = $('prompt-label');
const suggestBox  = $('suggestions');
const pwOverlay   = $('pw-overlay');
const pwInput     = $('pw-input');
const pwLabel     = $('pw-label');
const clockEl     = $('clock');
const matrixCanvas= $('matrix-canvas');

/* ── AUDIO ─────────────────────────────────────────────── */
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { muteSound = true; }
  }
  return audioCtx;
}

function beep(freq = 440, dur = 0.06, type = 'square', vol = 0.08) {
  if (muteSound) return;
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch(e) {}
}

function keystrokeSound() { beep(1200, 0.025, 'square', 0.04); }
function successSound()   { [523,659,784].forEach((f,i) => setTimeout(() => beep(f,0.12,'sine',0.1), i*100)); }
function errorSound()     { beep(180, 0.18, 'sawtooth', 0.12); }
function enterSound()     { beep(660, 0.08, 'sine', 0.1); }
function hackSound() {
  for (let i = 0; i < 12; i++) {
    setTimeout(() => beep(100 + Math.random()*2000, 0.05, 'square', 0.06), i * 120);
  }
}

/* ── MATRIX RAIN ───────────────────────────────────────── */
const ctx2d = matrixCanvas.getContext('2d');
let matrixCols = [], matrixRAF = null;

function initMatrix() {
  matrixCanvas.width  = window.innerWidth;
  matrixCanvas.height = window.innerHeight;
  const cols = Math.floor(matrixCanvas.width / 16);
  matrixCols = Array.from({length: cols}, () => Math.floor(Math.random() * matrixCanvas.height / 20));
}

function drawMatrix() {
  ctx2d.fillStyle = matrixFull ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.08)';
  ctx2d.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
  ctx2d.font = '14px monospace';
  matrixCols.forEach((y, i) => {
    const char = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
    const x = i * 16;
    if (matrixFull) {
      ctx2d.fillStyle = `hsl(${120 + Math.random()*20}, 100%, ${40 + Math.random()*30}%)`;
    } else {
      ctx2d.fillStyle = `rgba(0,255,65,${0.3 + Math.random()*0.7})`;
    }
    ctx2d.fillText(char, x, y * 20);
    matrixCols[i] = (y * 20 > matrixCanvas.height && Math.random() > 0.975) ? 0 : y + 1;
  });
  matrixRAF = requestAnimationFrame(drawMatrix);
}

function startMatrix(full = false) {
  matrixFull = full;
  matrixActive = true;
  initMatrix();
  if (matrixRAF) cancelAnimationFrame(matrixRAF);
  matrixCanvas.classList.toggle('active', !full);
  matrixCanvas.classList.toggle('fullscreen', full);
  drawMatrix();
}

function stopMatrix() {
  if (matrixRAF) { cancelAnimationFrame(matrixRAF); matrixRAF = null; }
  matrixActive = false;
  matrixCanvas.classList.remove('active','fullscreen');
  ctx2d.clearRect(0,0,matrixCanvas.width,matrixCanvas.height);
}

window.addEventListener('resize', () => { if (matrixActive) initMatrix(); });

/* ── CLOCK ─────────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  clockEl.textContent = now.toTimeString().slice(0,8);
}
setInterval(updateClock, 1000);
updateClock();

/* ── PERSISTENCE ───────────────────────────────────────── */
function loadHistory() {
  try { cmdHistory = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch(e) { cmdHistory = []; }
}

function saveHistory() {
  if (cmdHistory.length > MAX_HISTORY) cmdHistory = cmdHistory.slice(-MAX_HISTORY);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cmdHistory)); }
  catch(e) {}
}

/* ── OUTPUT HELPERS ────────────────────────────────────── */
function scrollBottom() {
  requestAnimationFrame(() => { output.scrollTop = output.scrollHeight; });
}

function appendEntry(cmdText, outputHTML, extraClass = '') {
  const entry = document.createElement('div');
  entry.className = 'entry';

  if (cmdText !== null) {
    const cmdLine = document.createElement('div');
    cmdLine.className = 'entry-cmd';
    const p = isRootMode ? 'root@h4ck3r:~#' : 'user@system:~$';
    cmdLine.innerHTML = `<span class="p-label">${escHtml(p)}</span>${escHtml(cmdText)}`;
    entry.appendChild(cmdLine);
  }

  if (outputHTML !== null) {
    const out = document.createElement('div');
    out.className = 'entry-output' + (extraClass ? ' ' + extraClass : '');
    out.innerHTML = outputHTML;
    entry.appendChild(out);
  }

  output.appendChild(entry);
  scrollBottom();
  return entry;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* Typing animation — writes into an element char-by-char */
function typeText(el, text, speed = TYPING_SPEED, onDone) {
  isTyping = true;
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  el.appendChild(cursor);

  let i = 0;
  const chars = [...text]; // unicode-safe

  function step() {
    if (i < chars.length) {
      cursor.before(document.createTextNode(chars[i]));
      i++;
      scrollBottom();
      setTimeout(step, speed + Math.random() * speed * 0.5);
    } else {
      cursor.remove();
      isTyping = false;
      if (onDone) onDone();
    }
  }
  step();
}

/* Animated typed output — creates entry then types into output div */
function appendTyped(cmdText, text, extraClass = '', speed = TYPING_SPEED, onDone) {
  const entry = appendEntry(cmdText, null, extraClass);
  const out = document.createElement('div');
  out.className = 'entry-output' + (extraClass ? ' ' + extraClass : '');
  entry.appendChild(out);
  typeText(out, text, speed, onDone);
  return out;
}

/* ── PROGRESS BAR ANIMATION ────────────────────────────── */
function renderProgressBars(tasks) {
  // tasks = [{label, target, color?}]
  const block = document.createElement('div');
  block.className = 'progress-block';

  const rows = tasks.map(t => {
    const row = document.createElement('div');
    row.className = 'prog-line';
    const lbl = document.createElement('span'); lbl.className = 'prog-label'; lbl.textContent = t.label;
    const bg  = document.createElement('div');  bg.className  = 'prog-bar-bg';
    const fill= document.createElement('div');  fill.className= 'prog-bar-fill';
    const pct = document.createElement('span'); pct.className = 'prog-pct'; pct.textContent = '0%';
    bg.appendChild(fill);
    row.appendChild(lbl); row.appendChild(bg); row.appendChild(pct);
    block.appendChild(row);
    return { fill, pct, target: t.target };
  });

  output.appendChild(block);
  scrollBottom();

  // animate each bar sequentially
  function animBar(idx) {
    if (idx >= rows.length) return;
    const { fill, pct, target } = rows[idx];
    let current = 0;
    const interval = setInterval(() => {
      current = Math.min(current + Math.random() * 8 + 2, target);
      fill.style.width = current + '%';
      pct.textContent  = Math.floor(current) + '%';
      if (current >= target) {
        clearInterval(interval);
        animBar(idx + 1);
      }
    }, 60);
  }
  animBar(0);
  return block;
}

/* ── SKILL BARS ────────────────────────────────────────── */
function renderSkillBars(skills) {
  const wrap = document.createElement('div');
  wrap.className = 'entry-output';
  skills.forEach(([name, pct]) => {
    const row = document.createElement('div'); row.className = 'skill-row';
    const n   = document.createElement('span'); n.className = 'skill-name'; n.textContent = name;
    const bg  = document.createElement('div');  bg.className = 'skill-bar-bg';
    const fill= document.createElement('div');  fill.className = 'skill-bar-fill';
    fill.style.width = '0%';
    const p   = document.createElement('span'); p.className = 'skill-pct'; p.textContent = pct + '%';
    bg.appendChild(fill);
    row.appendChild(n); row.appendChild(bg); row.appendChild(p);
    wrap.appendChild(row);
    setTimeout(() => { fill.style.transition = 'width 0.9s ease'; fill.style.width = pct + '%'; }, 50);
  });
  const entry = document.createElement('div'); entry.className = 'entry';
  const cmdLine = document.createElement('div'); cmdLine.className = 'entry-cmd';
  cmdLine.innerHTML = `<span class="p-label">${escHtml(isRootMode ? 'root@h4ck3r:~#' : 'user@system:~$')}</span>skills`;
  entry.appendChild(cmdLine); entry.appendChild(wrap);
  output.appendChild(entry);
  scrollBottom();
}

/* ── COMMAND DEFINITIONS ───────────────────────────────── */
const COMMANDS = {
  help: {
    desc: 'List all available commands',
    fn() {
      const all = [...Object.keys(COMMANDS), ...(isRootMode ? Object.keys(ROOT_COMMANDS) : [])].sort();
      const rows = all.map(k => {
        const c = COMMANDS[k] || ROOT_COMMANDS[k];
        return `<tr><td>${escHtml(k)}</td><td>${escHtml(c.desc || '')}</td></tr>`;
      }).join('');
      appendEntry('help', `<table class="cmd-table"><tbody>${rows}</tbody></table>`);
    }
  },

  about: {
    desc: 'About this terminal',
    fn() {
      const txt = [
        '╔══════════════════════════════════════╗',
        '║     FAKE HACKER TERMINAL v1.0        ║',
        '║     Built with vanilla JS/CSS/HTML   ║',
        '║     Author : Claude (Anthropic)      ║',
        '║     Year   : 2026                    ║',
        '║     Motto  : "We\'re in."             ║',
        '╚══════════════════════════════════════╝',
      ].join('\n');
      appendTyped('about', txt, 'bright', 8);
      successSound();
    }
  },

  clear: {
    desc: 'Clear the terminal',
    fn() {
      output.classList.add('fade-out-content');
      setTimeout(() => {
        output.innerHTML = '';
        output.classList.remove('fade-out-content');
        appendEntry(null, '<span style="color:#003a0e;font-size:11px;">// screen cleared</span>');
      }, 400);
    }
  },

  whoami: {
    desc: 'Display current user',
    fn() {
      const user = isRootMode ? 'root' : 'h4ck3r';
      appendTyped('whoami', `${user}@terminal:~$ uid=${isRootMode ? '0(root)' : '1337(h4ck3r)'} gid=1337 groups=1337,sudo,docker`, isRootMode ? 'root-mode' : 'bright', 15);
    }
  },

  pwd: {
    desc: 'Print working directory',
    fn() { appendEntry('pwd', '/home/h4ck3r/projects/terminal'); }
  },

  ls: {
    desc: 'List directory contents',
    fn() {
      const files = isRootMode
        ? ['<span style="color:#ff2222">shadow</span>', '<span style="color:#ff2222">passwd</span>', 'README.md', '<span style="color:var(--amber)">config.json</span>', 'exploit.sh', '.hidden_secrets', 'kernel_0day.c']
        : ['README.md', '<span style="color:var(--amber)">config.json</span>', 'projects/', 'notes.txt', '.bash_history'];
      appendEntry('ls', files.join('  '));
    }
  },

  date: {
    desc: 'Show current date/time',
    fn() { appendEntry('date', new Date().toString()); }
  },

  uptime: {
    desc: 'System uptime',
    fn() { appendEntry('uptime', `uptime: ${Math.floor(Math.random()*99+1)} days, ${Math.floor(Math.random()*24)}h ${Math.floor(Math.random()*60)}m — load average: 0.${Math.floor(Math.random()*9)}, 0.${Math.floor(Math.random()*9)}, 0.${Math.floor(Math.random()*9)}`); }
  },

  uname: {
    desc: 'System information',
    fn() { appendEntry('uname', 'H4CK-OS 6.6.6-ghost #1 SMP PREEMPT_RT x86_64 GNU/Linux'); }
  },

  projects: {
    desc: 'View portfolio projects',
    fn() {
      const html = `
<table class="cmd-table">
  <tbody>
    <tr><td>[01] CryptoSec</td><td>Blockchain-based zero-knowledge auth system</td></tr>
    <tr><td>[02] GhostNet</td><td>Distributed P2P mesh network over TOR</td></tr>
    <tr><td>[03] SQLi-Hunter</td><td>Automated SQL injection scanner (ethical)</td></tr>
    <tr><td>[04] NightOwl</td><td>AI-powered anomaly detection for SOC teams</td></tr>
    <tr><td>[05] TermSim</td><td>This terminal — built in pure vanilla JS</td></tr>
  </tbody>
</table>`;
      appendEntry('projects', html);
    }
  },

  contact: {
    desc: 'Contact information',
    fn() {
      const html = `
<table class="cmd-table">
  <tbody>
    <tr><td>email</td><td>h4ck3r@darkweb.onion</td></tr>
    <tr><td>github</td><td>github.com/h4ck3r</td></tr>
    <tr><td>twitter</td><td>@h4ck3r_term</td></tr>
    <tr><td>pgp</td><td>0xDEADBEEF CAFEBABE</td></tr>
  </tbody>
</table>`;
      appendEntry('contact', html);
    }
  },

  skills: {
    desc: 'Show technical skill levels',
    fn() {
      renderSkillBars([
        ['JavaScript',    95],
        ['Python',        88],
        ['Rust',          72],
        ['C / C++',       65],
        ['Networking',    90],
        ['Linux',         93],
        ['Cryptography',  80],
        ['Reverse Eng.',  70],
        ['Social Eng.',   99],
      ]);
    }
  },

  experience: {
    desc: 'Work history',
    fn() {
      const html = `
<table class="cmd-table">
  <tbody>
    <tr><td>2024–now</td><td>Senior Pentester @ ShadowSec Inc.</td></tr>
    <tr><td>2022–2024</td><td>Red Team Lead @ Ghost Protocol LLC</td></tr>
    <tr><td>2020–2022</td><td>Security Engineer @ DarkNet Systems</td></tr>
    <tr><td>2018–2020</td><td>Jr. Developer @ Bytecode Corp.</td></tr>
    <tr><td>2015–2018</td><td>Freelance CTF Competitor (Top 50 global)</td></tr>
  </tbody>
</table>`;
      appendEntry('experience', html);
    }
  },

  resume: {
    desc: 'Download resume (simulated)',
    fn() {
      appendTyped('resume', 'Generating resume.pdf...\nEncrypting with PGP key 0xDEADBEEF...\nDownload link: [REDACTED — classified]\n(Hint: the real resume is in your imagination.)', '', 20);
    }
  },

  login: {
    desc: 'Login to system',
    fn() {
      showPasswordPrompt('AUTHENTICATION REQUIRED — ENTER PASSWORD:', (pw) => {
        if (pw === 'skynet') {
          enterRoot();
        } else {
          errorSound();
          appendTyped('login', 'ACCESS DENIED. Invalid credentials.\nBrute-force attempt logged. IP blacklisted.', 'error', 20);
        }
      });
    }
  },

  logout: {
    desc: 'Logout from root',
    fn() {
      if (isRootMode) {
        isRootMode = false;
        document.body.classList.remove('root-mode');
        updatePrompt();
        appendEntry('logout', 'Logged out. Returning to user mode.');
      } else {
        appendEntry('logout', 'Not logged in as root.');
      }
    }
  },

  'hack system': {
    desc: 'Initiate hack sequence',
    fn: hackSystem
  },

  hack: {
    desc: 'Alias for "hack system"',
    fn: hackSystem
  },

  matrix: {
    desc: 'Enter the Matrix',
    fn() {
      appendTyped('matrix', 'Wake up, Neo...\nThe Matrix has you.\n\n[Press any key to exit]', 'bright', 30, () => {
        startMatrix(true);
        hackSound();
        const handler = () => {
          stopMatrix();
          appendEntry(null, '<span style="color:#003a0e;font-size:11px;">// You took the blue pill.</span>');
          document.removeEventListener('keydown', handler);
          document.removeEventListener('click', handler);
        };
        document.addEventListener('keydown', handler, { once: true });
        document.addEventListener('click', handler, { once: true });
      });
    }
  },

  sudo: {
    desc: 'Execute as superuser (try it...)',
    fn(args) {
      if (!args) {
        appendTyped('sudo', '[sudo] password for h4ck3r:', '', 20, () => {
          showPasswordPrompt('[sudo] password for h4ck3r:', (pw) => {
            if (pw === 'skynet') {
              enterRoot();
            } else {
              errorSound();
              appendTyped('sudo', 'Sorry, try again.\nSorry, try again.\nh4ck3r is not in the sudoers file. This incident will be reported.', 'error', 18);
            }
          });
        });
      } else {
        if (!isRootMode) {
          appendEntry(`sudo ${args}`, '<span class="error">Permission denied. (Try \'sudo\' to elevate)</span>');
          errorSound();
        } else {
          appendEntry(`sudo ${args}`, `Executing as root: ${args}`);
        }
      }
    }
  },

  ping: {
    desc: 'Ping a host',
    fn(args) {
      const host = args || 'localhost';
      const times = [12,8,15,10,9].map(t => t + Math.floor(Math.random()*5));
      const lines = [
        `PING ${host}: 56 bytes of data.`,
        ...times.map((t,i) => `64 bytes from ${host}: icmp_seq=${i+1} ttl=64 time=${t} ms`),
        `--- ${host} ping statistics ---`,
        `5 packets transmitted, 5 received, 0% packet loss`
      ].join('\n');
      appendTyped(`ping ${host}`, lines, '', 12);
    }
  },

  traceroute: {
    desc: 'Trace network route',
    fn(args) {
      const host = args || '8.8.8.8';
      const hops = [
        '1  192.168.1.1  1.2 ms',
        '2  10.0.0.1     5.8 ms',
        '3  172.16.0.1   12.3 ms',
        '4  ???          * * *',
        '5  [CLASSIFIED] [REDACTED]',
        `6  ${host}      42.0 ms`,
      ].join('\n');
      appendTyped(`traceroute ${host}`, `traceroute to ${host}:\n${hops}`, '', 25);
    }
  },

  ifconfig: {
    desc: 'Network interfaces',
    fn() {
      const out = `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
      inet 10.0.0.1  netmask 255.255.255.0  broadcast 10.0.0.255
      inet6 ::1  prefixlen 128  scopeid 0x10<host>
      ether 00:1A:2B:3C:4D:5E  txqueuelen 1000
      RX packets 1337  bytes 420420 (420.4 KB)
      TX packets 1337  bytes 420420 (420.4 KB)

lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536
      inet 127.0.0.1  netmask 255.0.0.0`;
      appendEntry('ifconfig', out);
    }
  },

  ps: {
    desc: 'List processes',
    fn() {
      const html = `<table class="cmd-table"><tbody>
<tr><td>PID</td><td>CMD</td><td>CPU%</td><td>MEM%</td></tr>
<tr><td>1</td><td>init</td><td>0.0</td><td>0.1</td></tr>
<tr><td>666</td><td>malware.sh</td><td>99.9</td><td>88.2</td></tr>
<tr><td>1337</td><td>h4ck_terminal</td><td>1.2</td><td>0.8</td></tr>
<tr><td>2048</td><td>ssh -i id_rsa</td><td>0.1</td><td>0.2</td></tr>
</tbody></table>`;
      appendEntry('ps', html);
    }
  },

  cat: {
    desc: 'Display file contents',
    fn(args) {
      if (!args) { appendEntry('cat', 'Usage: cat <filename>', 'error'); return; }
      const files = {
        'README.md':   '# H4CK3R TERMINAL\nA fake hacker terminal for fun.\nType `help` for commands.',
        'notes.txt':   'Remember:\n- Never leave a trace\n- Always use VPN\n- The password is skynet (shhh)',
        'config.json': '{\n  "user": "h4ck3r",\n  "level": 1337,\n  "mode": "ghost"\n}',
        '.bash_history':'ls\npwd\nhack system\nmatrix\ncat notes.txt',
      };
      const content = files[args] || `cat: ${args}: No such file or directory`;
      const cls = files[args] ? '' : 'error';
      appendEntry(`cat ${args}`, content, cls);
    }
  },

  echo: {
    desc: 'Print text',
    fn(args) { appendEntry(`echo ${args||''}`, args || ''); }
  },

  history: {
    desc: 'Show command history',
    fn() {
      if (cmdHistory.length === 0) { appendEntry('history', 'No history yet.'); return; }
      const lines = cmdHistory.map((c,i) => `  ${String(i+1).padStart(3,' ')}  ${c}`).join('\n');
      appendEntry('history', lines);
    }
  },

  mute: {
    desc: 'Toggle sound on/off',
    fn() {
      muteSound = !muteSound;
      appendEntry('mute', `Sound ${muteSound ? 'muted 🔇' : 'enabled 🔊'}`);
    }
  },

  theme: {
    desc: 'Cycle terminal themes (green/amber/white)',
    fn() {
      const themes = ['green','amber','white'];
      const cur = document.body.dataset.theme || 'green';
      const next = themes[(themes.indexOf(cur)+1) % themes.length];
      document.body.dataset.theme = next;
      const map = { green:'#00ff41', amber:'#ffb300', white:'#e8e8e8' };
      document.documentElement.style.setProperty('--green', map[next]);
      document.documentElement.style.setProperty('--green-dim', map[next]+'88');
      appendEntry('theme', `Theme switched to: ${next.toUpperCase()}`);
    }
  },

  banner: {
    desc: 'Show welcome banner',
    fn: showWelcome
  },

  fortune: {
    desc: 'Random hacker fortune',
    fn() {
      const fortunes = [
        '"The only truly secure system is one that is powered off, cast in a block of concrete and sealed in a lead-lined room with armed guards."',
        '"There is no patch for human stupidity."',
        '"It\'s not a bug, it\'s an undocumented feature."',
        '"Hackers are not criminals, they are explorers."',
        '"Security is a process, not a product." — Bruce Schneier',
        '"The quieter you become, the more you are able to hear." — Kali Linux motto',
        '"To hack is to repurpose." — Pekka Himanen',
      ];
      appendTyped('fortune', fortunes[Math.floor(Math.random() * fortunes.length)], 'bright', 22);
    }
  },

  nmap: {
    desc: 'Network scanner (simulated)',
    fn(args) {
      const target = args || '192.168.1.0/24';
      const lines = [
        `Starting Nmap 7.94 ( https://nmap.org )`,
        `Nmap scan report for ${target}`,
        `Host is up (0.0024s latency).`,
        `PORT     STATE  SERVICE`,
        `22/tcp   open   ssh`,
        `80/tcp   open   http`,
        `443/tcp  open   https`,
        `3306/tcp open   mysql  ← VULNERABLE`,
        `Nmap done: 1 IP address (1 host up) scanned in 2.34 seconds`,
      ].join('\n');
      appendTyped(`nmap ${target}`, lines, '', 18);
    }
  },

  ssh: {
    desc: 'SSH into remote server (simulated)',
    fn(args) {
      const host = args || 'root@darkserver.onion';
      const lines = [
        `Connecting to ${host}...`,
        'Authenticating with key: ~/.ssh/id_rsa',
        'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!',
        'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
        '...just kidding. Connection established.',
        `Last login: ${new Date().toUTCString()} from 10.0.0.1`,
      ].join('\n');
      appendTyped(`ssh ${host}`, lines, 'amber', 25);
    }
  },
};

/* ── ROOT-ONLY COMMANDS ────────────────────────────────── */
const ROOT_COMMANDS = {
  'rm -rf /': {
    desc: '[ROOT] Delete everything (just kidding)',
    fn() {
      const lines = ['Deleting /', 'rm: /bin: permission denied (even root respects safety)', 'rm: /home: would you really? NO.', '(Nothing was harmed in the making of this terminal.)'];
      appendTyped('rm -rf /', lines.join('\n'), 'root-mode', 30);
    }
  },
  nuke: {
    desc: '[ROOT] Launch nuclear strike (simulated)',
    fn() {
      appendTyped('nuke', 'Authenticating nuclear launch sequence...\nGenerating one-time pad...\nPINGING NORAD: TIMEOUT\nMissile launch aborted. (good)', 'root-mode', 25);
      hackSound();
    }
  },
  backdoor: {
    desc: '[ROOT] Install persistent backdoor',
    fn() {
      const tasks = [
        { label: 'Escalating privs', target: 100 },
        { label: 'Patching kernel',  target: 100 },
        { label: 'Hiding process',   target: 100 },
        { label: 'Installing hook',  target: 100 },
      ];
      appendEntry('backdoor', '<span style="color:var(--red)">Installing persistent backdoor...</span>');
      setTimeout(() => {
        renderProgressBars(tasks);
        setTimeout(() => appendEntry(null, '<span style="color:var(--red);text-shadow:var(--red-glow)">✓ Backdoor installed. Connection persists on reboot.</span>'), 3000);
      }, 300);
      hackSound();
    }
  },
};

/* ── HACK SYSTEM SEQUENCE ──────────────────────────────── */
function hackSystem() {
  const logs = [
    'Initializing exploit framework...',
    'Scanning target: 192.168.1.100',
    'Found open port: 22 (SSH)',
    'Attempting authentication bypass...',
    'Injecting shellcode buffer overflow...',
    'Spawning reverse shell...',
    'Escalating privileges to root...',
    'Covering tracks in /var/log/auth.log...',
    'Establishing encrypted C2 channel...',
  ];

  appendEntry('hack system', '<span style="color:var(--amber)">Initiating hack sequence... stand by</span>');
  hackSound();
  startMatrix(false);

  let delay = 200;
  logs.forEach((log, i) => {
    setTimeout(() => {
      const entry = document.createElement('div');
      entry.className = 'entry';
      const out = document.createElement('div');
      out.className = 'entry-output amber';
      out.textContent = `[${String(i+1).padStart(2,'0')}] ${log}`;
      entry.appendChild(out);
      output.appendChild(entry);
      scrollBottom();
    }, delay);
    delay += 300 + Math.random() * 200;
  });

  setTimeout(() => {
    const tasks = [
      { label: 'Firewall bypass', target: 100 },
      { label: 'Root escalation', target: 100 },
      { label: 'Data exfiltrate', target: 100 },
      { label: 'Track covering', target: 100 },
    ];
    renderProgressBars(tasks);
  }, delay);

  setTimeout(() => {
    appendTyped(null, '\n>>> ACCESS GRANTED <<<\nWelcome to the mainframe.\n(This is simulated. Please use hacking ethically.)', 'bright', 25);
    successSound();
    stopMatrix();
  }, delay + 3500);
}

/* ── ROOT MODE ─────────────────────────────────────────── */
function enterRoot() {
  isRootMode = true;
  document.body.classList.add('root-mode');
  updatePrompt();
  appendTyped('login', '\n⚠  ROOT ACCESS GRANTED ⚠\nYou now have god-level permissions.\nType \'help\' to see root commands.\nType \'logout\' to return to user mode.', 'root-mode', 20);
  successSound();
  startMatrix(false);
  setTimeout(stopMatrix, 5000);
}

function updatePrompt() {
  const p = isRootMode ? 'root@h4ck3r:~#' : 'user@system:~$';
  promptLabel.textContent = p;
  promptLabel.className   = 'prompt' + (isRootMode ? ' root' : '');
}

/* ── PASSWORD PROMPT ───────────────────────────────────── */
let _pwCallback = null;

function showPasswordPrompt(label, callback) {
  loginPending = true;
  _pwCallback  = callback;
  pwLabel.textContent = label;
  pwInput.value = '';
  pwOverlay.style.display = 'flex';
  setTimeout(() => pwInput.focus(), 100);
}

pwInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const pw = pwInput.value;
    pwOverlay.style.display = 'none';
    loginPending = false;
    cmdInput.focus();
    if (_pwCallback) { _pwCallback(pw); _pwCallback = null; }
  } else if (e.key === 'Escape') {
    pwOverlay.style.display = 'none';
    loginPending = false;
    cmdInput.focus();
    appendEntry('login', 'Authentication cancelled.', 'error');
  }
});

/* ── SUGGESTIONS ───────────────────────────────────────── */
function getAllCommandNames() {
  return [...Object.keys(COMMANDS), ...(isRootMode ? Object.keys(ROOT_COMMANDS) : [])].sort();
}

function showSuggestions(val) {
  if (!val) { hideSuggestions(); return; }
  const matches = getAllCommandNames().filter(c => c.startsWith(val) && c !== val);
  if (!matches.length) { hideSuggestions(); return; }

  suggestBox.innerHTML = '';
  suggestIdx = -1;
  matches.slice(0,6).forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'suggest-item';
    item.dataset.idx = i;
    const cmd = COMMANDS[m] || ROOT_COMMANDS[m];
    item.innerHTML = `<span class="suggest-key">${escHtml(m)}</span><span class="suggest-desc">${escHtml(cmd?.desc || '')}</span>`;
    item.addEventListener('click', () => { cmdInput.value = m; hideSuggestions(); cmdInput.focus(); });
    suggestBox.appendChild(item);
  });
  suggestBox.style.display = 'block';
}

function hideSuggestions() {
  suggestBox.style.display = 'none';
  suggestIdx = -1;
}

function navigateSuggestions(dir) {
  const items = suggestBox.querySelectorAll('.suggest-item');
  if (!items.length) return false;
  items.forEach(i => i.classList.remove('active'));
  suggestIdx = (suggestIdx + dir + items.length + 1) % (items.length + 1) - 0;
  if (suggestIdx < 0) suggestIdx = items.length - 1;
  if (suggestIdx >= items.length) { suggestIdx = -1; return false; }
  items[suggestIdx].classList.add('active');
  cmdInput.value = items[suggestIdx].querySelector('.suggest-key').textContent;
  return true;
}

/* ── EXECUTE COMMAND ───────────────────────────────────── */
function executeCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  // Save to history
  if (cmdHistory[cmdHistory.length - 1] !== trimmed) {
    cmdHistory.push(trimmed);
    saveHistory();
  }
  historyIdx = cmdHistory.length;
  hideSuggestions();

  enterSound();

  // Parse
  const parts = trimmed.toLowerCase();
  const space  = trimmed.indexOf(' ');
  const base   = space === -1 ? trimmed.toLowerCase() : trimmed.slice(0, space).toLowerCase();
  const args   = space === -1 ? '' : trimmed.slice(space + 1).trim();

  // Check full match (handles multi-word keys like "hack system")
  const fullLower = trimmed.toLowerCase();

  const allCmds = { ...COMMANDS, ...(isRootMode ? ROOT_COMMANDS : {}) };

  if (allCmds[fullLower]) {
    allCmds[fullLower].fn(args);
    return;
  }
  if (allCmds[base]) {
    allCmds[base].fn(args);
    return;
  }

  // Unknown
  errorSound();
  appendEntry(trimmed,
    `<span>Command not found: <strong>${escHtml(trimmed)}</strong>. Type '<span style="color:var(--green)">help</span>' for available commands.</span>`,
    'error'
  );
}

/* ── INPUT EVENTS ──────────────────────────────────────── */
cmdInput.addEventListener('keydown', (e) => {
  if (loginPending) return;

  switch(e.key) {
    case 'Enter':
      e.preventDefault();
      const val = cmdInput.value;
      cmdInput.value = '';
      hideSuggestions();
      executeCommand(val);
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (suggestBox.style.display !== 'none') { navigateSuggestions(-1); break; }
      if (historyIdx > 0) {
        historyIdx--;
        cmdInput.value = cmdHistory[historyIdx] || '';
        requestAnimationFrame(() => cmdInput.setSelectionRange(9999,9999));
      }
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (suggestBox.style.display !== 'none') { navigateSuggestions(1); break; }
      if (historyIdx < cmdHistory.length - 1) {
        historyIdx++;
        cmdInput.value = cmdHistory[historyIdx] || '';
      } else {
        historyIdx = cmdHistory.length;
        cmdInput.value = '';
      }
      break;

    case 'Tab':
      e.preventDefault();
      const cur = cmdInput.value.trim();
      if (!cur) break;
      const matches = getAllCommandNames().filter(c => c.startsWith(cur));
      if (matches.length === 1) { cmdInput.value = matches[0]; hideSuggestions(); }
      else if (matches.length > 1) { showSuggestions(cur); }
      break;

    case 'Escape':
      hideSuggestions();
      cmdInput.value = '';
      break;

    case 'l':
      if (e.ctrlKey) { e.preventDefault(); COMMANDS.clear.fn(); }
      break;

    default:
      keystrokeSound();
  }
});

cmdInput.addEventListener('input', () => {
  showSuggestions(cmdInput.value.trim());
});

/* Keep focus on input unless in overlay */
document.addEventListener('click', (e) => {
  if (!loginPending && !pwOverlay.contains(e.target)) {
    cmdInput.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (!loginPending && document.activeElement !== cmdInput && e.key.length === 1) {
    cmdInput.focus();
  }
});

/* ── WELCOME BANNER ────────────────────────────────────── */
function showWelcome() {
  const art = `
  ██╗  ██╗ █████╗  ██████╗██╗  ██╗
  ██║  ██║██╔══██╗██╔════╝██║ ██╔╝
  ███████║███████║██║     █████╔╝ 
  ██╔══██║██╔══██║██║     ██╔═██╗ 
  ██║  ██║██║  ██║╚██████╗██║  ██╗
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
  T E R M I N A L   v 1 . 0`;

  const el = document.createElement('div');
  el.className = 'entry';
  const pre = document.createElement('pre');
  pre.className = 'welcome-art';
  pre.textContent = art;
  el.appendChild(pre);

  const info = document.createElement('div');
  info.className = 'entry-output welcome-info';
  info.innerHTML = `<span class="hi">Welcome, h4ck3r.</span> Type <span class="hi">help</span> for commands. Type <span class="hi">hack system</span> to begin.\n<span style="color:#003a0e;font-size:11px;">[ All activities are logged and monitored. Proceed with caution. ]</span>`;
  el.appendChild(info);
  output.appendChild(el);
  scrollBottom();
}

/* ── BOOT SEQUENCE ─────────────────────────────────────── */
function runBoot() {
  let i = 0;
  const totalLines = BOOT_LINES.length;

  function nextLine() {
    if (i >= totalLines) {
      // Boot complete
      setTimeout(() => {
        bootScreen.classList.add('fade-out');
        setTimeout(() => {
          bootScreen.style.display = 'none';
          terminal.style.display = 'flex';
          startMatrix(false);
          loadHistory();
          showWelcome();
          cmdInput.focus();
        }, 800);
      }, 400);
      return;
    }

    const line = BOOT_LINES[i];
    const span = document.createElement('span');
    span.className = `bline ${line.t}`;
    span.textContent = line.m;
    bootLog.appendChild(span);
    bootLog.scrollTop = bootLog.scrollHeight;

    const pct = Math.round(((i + 1) / totalLines) * 100);
    bootBar.style.width = pct + '%';

    beep(line.t === 'err' ? 300 : 800, 0.04, 'square', 0.05);
    i++;
    setTimeout(nextLine, 120 + Math.random() * 100);
  }

  setTimeout(nextLine, 600);
}

/* ── INIT ──────────────────────────────────────────────── */
window.addEventListener('load', () => {
  runBoot();
});
