/* ============================================
   PLEAD WITH THE PRINTER
   Game Engine & Narrative Content
   ============================================ */

// ==========================================
// GAME STATE
// ==========================================

const DEFAULT_STATE = {
  mood: 50,           // 0 = hostile, 100 = divine grace
  toner: 50,          // 0 = empty, 100 = overflowing
  jam: 0,             // 0 = none, 100 = apocalyptic
  faith: 50,          // 0 = office has lost all hope, 100 = zealous belief
  pagesRemaining: 1,  // the sacred document
  currentScene: 'intro',
  scenarioId: 'quarterly_report', // overwritten at game start
  turnCount: 0,
  calledGary: false,
  offeredTribute: false,
  openedTray2: false,
  struckPrinter: false,
  recitedLitany: false,
  sacrificedColor: false,
  whisperedToSpooler: false,
  rebootAttempted: false,
  paperInserted: false,
  duplexRequested: false,
  cancelledJobs: false,
  garyArrivalTurn: -1,
  crisisCount: 0,
  soundEnabled: false,
  runNumber: 1,
};

let state = { ...DEFAULT_STATE, usedScenarioChoices: new Set() };
let typewriterQueue = [];
let isTyping = false;
let choicesLocked = false;

// ==========================================
// AUDIO ENGINE (Web Audio API — no files needed)
// ==========================================

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone({ type = 'square', freq = 440, freq2 = null, gain = 0.08, duration = 0.06, attack = 0.005, decay = 0.05 } = {}) {
  if (!state.soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (freq2) osc.frequency.linearRampToValueAtTime(freq2, ctx.currentTime + duration);
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(gain, ctx.currentTime + attack);
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + attack + decay);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration + 0.01);
}

// Subtle mechanical tick for each typed character
let tickToggle = false;
function playTypeClick() {
  tickToggle = !tickToggle;
  playTone({ type: 'square', freq: tickToggle ? 180 : 160, gain: 0.04, duration: 0.03, attack: 0.002, decay: 0.025 });
}

// Short click when a choice button is pressed
function playChoiceClick() {
  playTone({ type: 'square', freq: 320, freq2: 280, gain: 0.12, duration: 0.07, attack: 0.003, decay: 0.06 });
}

// Warning beep for system alerts and bad events
function playWarning() {
  playTone({ type: 'sawtooth', freq: 440, freq2: 380, gain: 0.15, duration: 0.2, attack: 0.01, decay: 0.18 });
  setTimeout(() => playTone({ type: 'sawtooth', freq: 440, freq2: 380, gain: 0.1, duration: 0.15, attack: 0.01, decay: 0.13 }), 250);
}

// Positive chime for good outcomes / success
function playSuccess() {
  [440, 554, 659].forEach((freq, i) => {
    setTimeout(() => playTone({ type: 'sine', freq, gain: 0.15, duration: 0.25, attack: 0.01, decay: 0.22 }), i * 100);
  });
}

// Low impact thud for shake events
function playImpact() {
  playTone({ type: 'sawtooth', freq: 80, freq2: 40, gain: 0.25, duration: 0.3, attack: 0.005, decay: 0.28 });
}

// Printer whirr/grind for dramatic printer events
function playPrinterNoise() {
  [120, 140, 110, 150, 100].forEach((freq, i) => {
    setTimeout(() => playTone({ type: 'sawtooth', freq, gain: 0.1, duration: 0.15, attack: 0.01, decay: 0.12 }), i * 80);
  });
}

// Ascending blip for scene transitions
function playTransition() {
  playTone({ type: 'square', freq: 220, freq2: 330, gain: 0.08, duration: 0.12, attack: 0.005, decay: 0.1 });
}

// ==========================================
// MOOD / JAM / LABEL HELPERS
// ==========================================

function getMoodLabel(mood) {
  if (mood <= 10) return { text: 'WRATHFUL', css: 'mood-hostile' };
  if (mood <= 25) return { text: 'HOSTILE', css: 'mood-angry' };
  if (mood <= 40) return { text: 'SUSPICIOUS', css: 'mood-suspicious' };
  if (mood <= 55) return { text: 'UNCERTAIN', css: 'mood-uncertain' };
  if (mood <= 70) return { text: 'NEUTRAL', css: 'mood-neutral' };
  if (mood <= 85) return { text: 'RECEPTIVE', css: 'mood-receptive' };
  if (mood <= 95) return { text: 'PLEASED', css: 'mood-pleased' };
  return { text: 'DIVINE GRACE', css: 'mood-divine' };
}

function getJamLabel(jam) {
  if (jam <= 5) return { text: 'NONE', css: 'jam-none' };
  if (jam <= 30) return { text: 'MINOR', css: 'jam-minor' };
  if (jam <= 60) return { text: 'MODERATE', css: 'jam-moderate' };
  if (jam <= 85) return { text: 'SEVERE', css: 'jam-severe' };
  return { text: 'APOCALYPTIC', css: 'jam-apocalyptic' };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(pct) {
  return Math.random() * 100 < pct;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// UI FUNCTIONS
// ==========================================

const outputEl = document.getElementById('text-output');
const choicesEl = document.getElementById('choices-container');
const alertEl = document.getElementById('system-alert');
const alertTextEl = document.getElementById('system-alert-text');
const flashEl = document.getElementById('screen-flash');

function updateStatusPanel() {
  const moodInfo = getMoodLabel(state.mood);
  const moodEl = document.getElementById('stat-mood');
  moodEl.textContent = moodInfo.text;
  moodEl.className = `badge badge-sm ${moodInfo.css}`;

  document.getElementById('stat-toner').value = state.toner;
  document.getElementById('stat-toner-text').textContent = state.toner + '%';

  const jamInfo = getJamLabel(state.jam);
  const jamEl = document.getElementById('stat-jam');
  jamEl.textContent = jamInfo.text;
  jamEl.className = `badge badge-sm ${jamInfo.css}`;

  document.getElementById('stat-faith').value = state.faith;
  document.getElementById('stat-faith-text').textContent = state.faith + '%';

  document.getElementById('stat-pages').textContent = state.pagesRemaining;
  document.getElementById('run-counter').textContent = state.runNumber;

  // Color toner bar based on level
  const tonerBar = document.getElementById('stat-toner');
  if (state.toner <= 15) {
    tonerBar.classList.remove('progress-warning');
    tonerBar.classList.add('progress-error');
  } else {
    tonerBar.classList.remove('progress-error');
    tonerBar.classList.add('progress-warning');
  }
}

function addEventLog(msg) {
  const logEl = document.getElementById('event-log');
  const p = document.createElement('p');
  p.textContent = '> ' + msg;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
  // Keep max 20 entries
  while (logEl.children.length > 20) {
    logEl.removeChild(logEl.firstChild);
  }
}

function scrollOutput() {
  outputEl.scrollTop = outputEl.scrollHeight;
}

// Typewriter effect: character by character with a blinking cursor
function typewriteLine(text, cssClass) {
  return new Promise((resolve) => {
    const p = document.createElement('p');
    p.className = `text-line ${cssClass}`;

    // Empty lines render instantly
    if (!text || text.length === 0) {
      p.innerHTML = '&nbsp;';
      outputEl.appendChild(p);
      scrollOutput();
      resolve();
      return;
    }

    outputEl.appendChild(p);

    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';
    p.appendChild(cursor);

    let i = 0;
    const msPerChar = 28; // ~35 chars/sec — readable but clearly "typed"

    function typeChar() {
      if (i < text.length) {
        cursor.remove();
        p.appendChild(document.createTextNode(text[i]));
        p.appendChild(cursor);
        i++;
        playTypeClick();
        scrollOutput();
        setTimeout(typeChar, msPerChar);
      } else {
        cursor.remove();
        scrollOutput();
        resolve();
      }
    }
    typeChar();
  });
}

// Instant line (no typewriter)
function addLine(text, cssClass = 'text-narrative') {
  const p = document.createElement('p');
  p.className = `text-line ${cssClass}`;
  p.style.opacity = '1';
  p.textContent = text;
  outputEl.appendChild(p);
  scrollOutput();
}

function addDivider() {
  addLine('─'.repeat(50), 'text-divider');
}

// Divider sentinel for use inside displayLines arrays
const DIVIDER = { __divider: true };

// Queue-based typewriter system so lines appear sequentially
async function displayLines(lines) {
  choicesLocked = true;
  for (const line of lines) {
    // Skip undefined/null (e.g. from inline function calls)
    if (line == null) continue;
    // Handle divider sentinel
    if (line.__divider) {
      addDivider();
      continue;
    }
    if (typeof line === 'string') {
      await typewriteLine(line, 'text-narrative', 15);
    } else {
      await typewriteLine(line.text, line.css || 'text-narrative', line.speed || 15);
    }
    await sleep(180);
  }
  choicesLocked = false;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clearOutput() {
  outputEl.innerHTML = '';
}

// Screen effects
function flashScreen(color = 'red') {
  flashEl.className = `screen-flash flash-${color}`;
  setTimeout(() => { flashEl.className = 'screen-flash'; }, 150);
  if (color === 'red') playWarning();
  else if (color === 'green') playSuccess();
}

function shakeScreen() {
  document.body.classList.add('shaking');
  setTimeout(() => document.body.classList.remove('shaking'), 400);
  playImpact();
}

let alertTimeout = null;
function showSystemAlert(text, duration = 3000) {
  alertTextEl.textContent = text;
  alertEl.classList.remove('hidden');
  playWarning();
  if (alertTimeout) clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    alertEl.classList.add('hidden');
  }, duration);
}

// ==========================================
// CHOICE RENDERING
// ==========================================

function showChoices(choices) {
  choicesEl.innerHTML = '';
  choices.forEach((choice) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm';
    btn.textContent = choice.text;
    btn.addEventListener('click', () => {
      if (choicesLocked) return;
      playChoiceClick();
      handleChoice(choice).catch(err => {
        console.error('handleChoice error:', err);
        choicesLocked = false;
        showChoices(getStandardChoices());
      });
    });
    // Disable if condition not met
    if (choice.condition && !choice.condition()) {
      btn.disabled = true;
      btn.classList.add('btn-disabled', 'opacity-30');
    }
    choicesEl.appendChild(btn);
  });
}

function clearChoices() {
  choicesEl.innerHTML = '';
}

// ==========================================
// SYSTEM ALERTS (random flavor)
// ==========================================

const RANDOM_ALERTS = [
  'WARNING: TONER PROPHECY UNFULFILLED',
  'ALERT: DUPLEX MERCY DENIED',
  'NOTICE: TRAY 2 HAS BEEN JUDGMENTAL',
  'CRITICAL: SPOOLER DAEMON DISPLEASED',
  'WARNING: PCL6 COVENANT VIOLATED',
  'ALERT: FUSER ASSEMBLY DEMANDS TRIBUTE',
  'NOTICE: PAGE YIELD BELOW PROPHECY THRESHOLD',
  'WARNING: DRUM UNIT ENTERING PURGATORY',
  'CRITICAL: USB HANDSHAKE REBUFFED',
  'ALERT: CYAN HAS ABANDONED THE CARTRIDGE',
  'NOTICE: PRINT QUEUE CONTAINS EXISTENTIAL DOUBT',
  'WARNING: PAPER PATH REQUIRES SPIRITUAL ALIGNMENT',
  'ALERT: ERROR 0xDEAD — TONER GHOST DETECTED',
  'NOTICE: THE OFFICE HAS BEEN JUDGED',
  'CRITICAL: MAINTENANCE KIT DEMANDS SACRIFICE',
  'WARNING: COLLATION SEQUENCE EMOTIONALLY UNSTABLE',
];

function maybeShowAlert() {
  if (chance(40)) {
    showSystemAlert(pick(RANDOM_ALERTS), 3500);
  }
}

// ==========================================
// CRISIS EVENTS (random mid-game interrupts)
// ==========================================

const CRISIS_EVENTS = [
  {
    id: 'phantom_jam',
    text: [
      { text: '>> INTERRUPT: PHANTOM JAM DETECTED <<', css: 'text-error' },
      'The printer reports a paper jam in a tray that does not exist.',
      'Tray 7. There is no Tray 7. There has never been a Tray 7.',
      'The printer insists. Tray 7 must be cleared.',
    ],
    effect: () => { state.jam = clamp(state.jam + 15, 0, 100); state.mood = clamp(state.mood - 8, 0, 100); },
    log: 'Phantom jam in Tray 7 (nonexistent)',
  },
  {
    id: 'toner_vision',
    text: [
      { text: '>> INTERRUPT: TONER HALLUCINATION <<', css: 'text-warning' },
      'The printer claims its toner level is simultaneously 0% and 100%.',
      'It refuses to elaborate. The display flickers between "REPLACE TONER" and "TONER OVERFLOW."',
      'Schr\u00F6dinger\'s cartridge. The office grows uneasy.',
    ],
    effect: () => { state.toner = clamp(state.toner - 10, 0, 100); state.faith = clamp(state.faith - 5, 0, 100); },
    log: 'Toner superposition event',
  },
  {
    id: 'queue_revolt',
    text: [
      { text: '>> INTERRUPT: PRINT QUEUE MUTINY <<', css: 'text-error' },
      'The queued documents have reorganized themselves by perceived importance.',
      'Your document has been ranked below "Dave\'s Fantasy Football Spreadsheet."',
      'The queue has developed opinions. This is unprecedented.',
    ],
    effect: () => { state.mood = clamp(state.mood - 5, 0, 100); state.faith = clamp(state.faith - 8, 0, 100); },
    log: 'Queue mutiny — documents self-organizing',
  },
  {
    id: 'heat_event',
    text: [
      { text: '>> INTERRUPT: FUSER TEMPERATURE ANOMALY <<', css: 'text-warning' },
      'The fuser assembly has exceeded recommended temperature by 200%.',
      'The air around the printer shimmers like a desert mirage.',
      'Karen from Accounting reports her coffee warmed itself when placed nearby.',
    ],
    effect: () => { state.jam = clamp(state.jam + 10, 0, 100); state.mood = clamp(state.mood - 5, 0, 100); },
    log: 'Fuser overtemp — ambient coffee warming',
  },
  {
    id: 'spiritual_event',
    text: [
      { text: '>> INTERRUPT: SPIRITUAL DISTURBANCE <<', css: 'text-warning' },
      'The printer emits a low hum that several employees describe as "chanting."',
      'The overhead lights flicker in a pattern that resembles ancient Epson runes.',
      'The intern claims they can smell ozone and regret.',
    ],
    effect: () => { state.mood = clamp(state.mood + rng(-10, 10), 0, 100); state.faith = clamp(state.faith + 5, 0, 100); },
    log: 'Spiritual disturbance — Epson runes observed',
  },
];

// ==========================================
// SCENARIOS — one chosen randomly each run
// ==========================================

const SCENARIOS = [
  {
    id: 'quarterly_report',
    document: 'the quarterly report',
    startAlert: 'WARNING: PRINTER HAS ENTERED UNSTABLE SPIRITUAL STATE',
    startLog: 'Quarterly report print job submitted',
    startState: {},
    choices: [
      { text: 'Email the report instead',        action: () => 'qr_email_it'      },
      { text: 'Ask a colleague to print it',     action: () => 'qr_ask_colleague' },
      { text: 'Try printing to PDF',             action: () => 'qr_print_to_pdf'  },
    ],
    lines: [
      { text: '[ INCIDENT LOG — PRIORITY: MAXIMUM ]', css: 'text-system' },
      '',
      'It is 4:47 PM on a Friday.',
      'You have one document. One page. One chance.',
      'The quarterly report is due in thirteen minutes.',
      '',
      'You approach the HP LaserJet 4200 — known to the office only as',
      { text: '"The Beast."', css: 'text-warning' },
      '',
      'It sits in the corner of the third floor, humming with ancient malice.',
      'Its display reads: "READY." But you know better.',
      'The Beast is never ready. The Beast is merely waiting.',
      '',
      'You press PRINT on your computer.',
      'The Beast stirs.',
      '',
      { text: 'A single amber light begins to blink.', css: 'text-warning' },
      'The office falls silent.',
      '',
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'Your journey begins.',
    ],
  },

  {
    id: 'resignation_letter',
    document: 'the resignation letter',
    startAlert: 'ALERT: HIGH-STAKES DOCUMENT DETECTED — TONER RESERVES TIGHTENING',
    startLog: 'Resignation letter — departure ceremony at 5PM',
    startState: { toner: 35 },
    choices: [
      { text: 'Reconsider — maybe don\'t resign',      action: () => 'rl_reconsider'          },
      { text: 'Ask the printer if you should stay',    action: () => 'rl_ask_printer_opinion' },
      { text: 'Print your CV instead, just in case',  action: () => 'rl_print_cv'            },
    ],
    lines: [
      { text: '[ INCIDENT LOG — CATEGORY: EXISTENTIAL ]', css: 'text-system' },
      '',
      'Today is your last day.',
      'You typed the letter at 4:52 PM. Two paragraphs. Very dignified.',
      '"Effective immediately." You used the good font.',
      '',
      'All that remains is to print it.',
      'To make it real. Official. Irrevocable.',
      '',
      'You approach the HP LaserJet 4200.',
      { text: 'It has known this moment was coming.', css: 'text-warning' },
      '',
      'The display reads: "READY."',
      'The fuser hums — low, sardonic.',
      '',
      'You submit the print job.',
      'The Beast considers whether to honor your departure or',
      { text: 'make it one to remember.', css: 'text-warning' },
      '',
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'Of course it does.',
    ],
  },

  {
    id: 'wedding_invitations',
    document: 'the wedding invitations',
    startAlert: 'WARNING: CEREMONIAL DOCUMENT LOAD — TRAY SPIRITUALLY UNPREPARED',
    startLog: 'Wedding invitations — ceremony tomorrow at 2PM',
    startState: { faith: 65, jam: 10 },
    choices: [
      { text: 'Explain the importance of the occasion', action: () => 'wi_explain_occasion' },
      { text: 'Invite the printer to the wedding',      action: () => 'wi_invite_printer'   },
      { text: 'Print just one copy as a test',          action: () => 'wi_test_copy'        },
    ],
    lines: [
      { text: '[ INCIDENT LOG — OCCASION: MATRIMONIAL ]', css: 'text-system' },
      '',
      'The wedding is tomorrow.',
      'You have 87 guests. You have 87 invitations to print.',
      'You have one printer.',
      '',
      'The florist has been paid. The caterer confirmed.',
      'The officiant memorised the vows.',
      'Everything is in order.',
      '',
      { text: 'Everything except this.', css: 'text-warning' },
      '',
      'You approach the HP LaserJet 4200.',
      'It sits beneath the fluorescent lights like a jilted ex.',
      'It has attended many office weddings. It approves of none of them.',
      '',
      'You send the print job.',
      '',
      { text: 'A single amber light begins to blink.', css: 'text-warning' },
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'The guests are coming. The Beast is unmoved.',
    ],
  },

  {
    id: 'tax_return',
    document: 'the tax return',
    startAlert: 'CRITICAL: IRS DEADLINE IN 94 MINUTES — PRINTER UNMOVED BY LEGAL PRESSURE',
    startLog: 'Tax return — IRS deadline tonight',
    startState: { mood: 40, toner: 45 },
    choices: [
      { text: 'Threaten it with an IRS audit',        action: () => 'tr_irs_threat'       },
      { text: 'Claim the printer as a tax deduction', action: () => 'tr_claim_deduction'  },
      { text: 'Simplify the return to one page',      action: () => 'tr_simplify_return'  },
    ],
    lines: [
      { text: '[ INCIDENT LOG — AUTHORITY: FEDERAL ]', css: 'text-system' },
      '',
      'It is April 15th.',
      'It is 10:26 PM.',
      'The IRS does not accept "the printer was being spiritual" as an extension.',
      '',
      'Ninety-four pages. Seven years of receipts.',
      'You have been preparing this return since February.',
      '',
      'You approach the HP LaserJet 4200.',
      'The tax return is open on your screen.',
      'The cursor blinks. The deadline does not.',
      '',
      { text: 'The Beast has no opinion about tax law.', css: 'text-warning' },
      'It has opinions about everything else.',
      '',
      'You press PRINT.',
      '',
      { text: 'A single amber light begins to blink.', css: 'text-warning' },
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'The IRS will not be sympathetic. The Beast does not care.',
    ],
  },

  {
    id: 'conference_handouts',
    document: 'the conference handouts',
    startAlert: 'WARNING: KEYNOTE IN 8 MINUTES — PRINTER ENTERING CONTEMPLATIVE STATE',
    startLog: '50-copy handout job — keynote in 8 minutes',
    startState: { pagesRemaining: 50, toner: 60, jam: 5 },
    choices: [
      { text: 'Reduce to 10 copies — people can share', action: () => 'ch_reduce_copies' },
      { text: 'Walk onstage without handouts',          action: () => 'ch_go_onstage'    },
      { text: 'Print only the title page, hold it up', action: () => 'ch_title_only'    },
    ],
    lines: [
      { text: '[ INCIDENT LOG — VENUE: MAIN STAGE ]', css: 'text-system' },
      '',
      'The keynote begins in eight minutes.',
      'Two hundred people are finding their seats.',
      'The AV team has already done their check.',
      'The slide clicker is charged.',
      '',
      'You need fifty copies of the handout.',
      'Thirty-two pages each.',
      '',
      { text: 'You do the math. You wish you hadn\'t.', css: 'text-warning' },
      '',
      'You approach the HP LaserJet 4200.',
      'It sits backstage, between the craft services table',
      'and a box of unsold merchandise from last year\'s conference.',
      '',
      'You submit the job: 50 copies. Collated. Stapled.',
      '',
      { text: 'The Beast considers the request.', css: 'text-warning' },
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'The audience is clapping for the warm-up speaker. Your time is running out.',
    ],
  },

  {
    id: 'performance_review',
    document: 'the performance review',
    startAlert: 'NOTICE: SELF-ASSESSMENT DOCUMENT DETECTED — PRINTER JUDGING IN RETURN',
    startLog: 'Self-assessment due — HR waiting upstairs',
    startState: { faith: 40, mood: 45 },
    choices: [
      { text: 'Lower your self-rating to appease it',           action: () => 'pr_lower_rating'       },
      { text: 'Ask the printer to rate your performance',       action: () => 'pr_printer_rates_you'  },
      { text: 'Add "Excellent printer relations" to your CV',   action: () => 'pr_add_printer_praise' },
    ],
    lines: [
      { text: '[ INCIDENT LOG — SUBJECT: SELF-EVALUATION ]', css: 'text-system' },
      '',
      'HR sent the reminder three weeks ago.',
      'Then two weeks ago. Then last Friday. Then this morning.',
      'Then Karen from HR appeared at your desk and used the phrase',
      { text: '"non-negotiable deadline."', css: 'text-warning' },
      '',
      'You have finally completed your annual self-assessment.',
      'Eight pages. Single-spaced. You rated yourself "Exceeds Expectations"',
      'in four categories. You will not be mentioning this to anyone.',
      '',
      'You approach the HP LaserJet 4200.',
      'The printer has also been evaluating you.',
      { text: 'The printer has also formed opinions.', css: 'text-warning' },
      '',
      'You submit the job.',
      '',
      { text: 'A single amber light begins to blink.', css: 'text-warning' },
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      '"Does not meet expectations," the printer implies.',
    ],
  },

  {
    id: 'classified_document',
    document: 'the classified document',
    startAlert: 'CRITICAL: UNCLASSIFIED PRINT DESTINATION FOR CLASSIFIED PAYLOAD',
    startLog: 'Document: CLASSIFIED — origin: unknown sender in IT',
    startState: { mood: 45, faith: 55, toner: 55 },
    choices: [
      { text: 'Peek at the document before printing',      action: () => 'cd_peek_document'        },
      { text: 'Demand authorization before proceeding',    action: () => 'cd_demand_authorization' },
      { text: 'Print it immediately and tell no one',      action: () => 'cd_print_fast'           },
    ],
    lines: [
      { text: '[ INCIDENT LOG — CLEARANCE: UNKNOWN ]', css: 'text-system' },
      '',
      'The email arrived at 3:03 PM from an IT address you don\'t recognise.',
      'Subject line: "PLEASE PRINT - URGENT."',
      'Attachment: classified_document_FINAL_v3_REAL.pdf',
      '',
      'You don\'t know what\'s in it.',
      'You don\'t know who sent it.',
      'The instructions say to print it, leave it in the output tray,',
      { text: 'and tell no one.', css: 'text-warning' },
      '',
      'You approach the HP LaserJet 4200.',
      'It has printed classified documents before.',
      'It has never told anyone about them either.',
      '',
      { text: 'You and The Beast have that in common.', css: 'text-warning' },
      '',
      'You send the job.',
      '',
      { text: 'A single amber light begins to blink.', css: 'text-warning' },
      { text: 'The printer speaks: "PC LOAD LETTER."', css: 'text-error' },
      '',
      'Even secrets must wait their turn.',
    ],
  },
];

// ==========================================
// SCENE DEFINITIONS
// ==========================================

const SCENES = {
  // --- INTRO ---
  intro: {
    enter: async () => {
      const scenario = SCENARIOS.find(s => s.id === state.scenarioId) || SCENARIOS[0];
      await displayLines(scenario.lines);
      addEventLog(scenario.startLog);
      addEventLog('Amber warning light active');
      showSystemAlert(scenario.startAlert, 4000);
    },
    choices: [
      {
        text: 'Approach with caution',
        action: () => {
          state.mood = clamp(state.mood + 5, 0, 100);
          return 'approach_cautious';
        }
      },
      {
        text: 'Assert dominance — slam the print button again',
        action: () => {
          state.mood = clamp(state.mood - 15, 0, 100);
          state.jam = clamp(state.jam + 10, 0, 100);
          return 'approach_aggressive';
        }
      },
      {
        text: 'Check the display panel',
        action: () => {
          return 'check_display';
        }
      },
    ]
  },

  // --- APPROACH CAUTIOUS ---
  approach_cautious: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You approach The Beast with measured steps, palms open, showing no threat.',
        'Corporate training never covered this, but instinct guides you.',
        '',
        'The amber light pulses — once, twice — as if acknowledging your presence.',
        'The display shifts: "AWAITING INPUT."',
        '',
        'You are close enough to hear it now. A faint whirring.',
        'Not mechanical. Almost... respiratory.',
        '',
        { text: 'The Beast is breathing.', css: 'text-warning' },
        'It is waiting for you to make your case.',
      ]);
      addEventLog('Cautious approach — printer responding');
    },
    choices: () => getStandardChoices(),
  },

  // --- APPROACH AGGRESSIVE ---
  approach_aggressive: {
    enter: async () => {
      shakeScreen();
      flashScreen('red');
      await displayLines([
        DIVIDER,
        { text: 'ERROR. ERROR. ERROR.', css: 'text-error' },
        '',
        'You slam the print button seven times in rapid succession.',
        'Each press echoes through the office like a declaration of war.',
        '',
        'The Beast\'s display erupts:',
        { text: '"MULTIPLE PRINT JOBS QUEUED. PRIORITY: VENGEANCE."', css: 'text-error' },
        '',
        'A grinding sound emerges from within. Not paper. Something deeper.',
        'The amber light turns red.',
        'Red is never good.',
        '',
        'Three pages of last month\'s TPS report eject at high velocity,',
        'striking the wall behind you like a warning shot.',
        '',
        { text: 'The Beast remembers. The Beast keeps score.', css: 'text-warning' },
      ]);
      addEventLog('Aggressive approach — printer HOSTILE');
      showSystemAlert('CRITICAL: PRINTER THREAT LEVEL ELEVATED', 3000);
    },
    choices: () => getStandardChoices(),
  },

  // --- CHECK DISPLAY ---
  check_display: {
    enter: async () => {
      const messages = [
        '"PC LOAD LETTER" — origin: UNKNOWN',
        '"TRAY 1: EMPTY (SPIRITUALLY)"',
        '"TONER: YES BUT ALSO NO"',
        '"FUSER READY / FUSER AFRAID"',
        `"PRINT JOBS IN QUEUE: ${rng(1, 666)}"`,
        '"LAST CALIBRATION: BEFORE TIME"',
      ];
      await displayLines([
        DIVIDER,
        'You lean in to read The Beast\'s cryptic display panel.',
        'The LCD screen cycles through a series of messages:',
        '',
        ...messages.map(m => ({ text: `  ${m}`, css: 'text-system' })),
        '',
        'None of these are standard HP error codes.',
        'You checked the manual once. The manual wept.',
        '',
        { text: 'The display settles on: "STATE YOUR BUSINESS."', css: 'text-warning' },
      ]);
      addEventLog('Display check — non-standard codes');
    },
    choices: () => getStandardChoices(),
  },

  // --- OFFER TONER TRIBUTE ---
  offer_tribute: {
    enter: async () => {
      state.offeredTribute = true;
      flashScreen('amber');
      await displayLines([
        DIVIDER,
        'You produce a sealed toner cartridge from the supply closet.',
        'HP 38A. Genuine. Still in its sacred anti-static bag.',
        '',
        'You hold it aloft like an offering to a jealous god.',
        '',
        '"I bring tribute," you whisper. "Accept this vessel of carbon and polymer."',
        '',
      ]);

      if (state.mood >= 40) {
        state.toner = clamp(state.toner + 30, 0, 100);
        state.mood = clamp(state.mood + 15, 0, 100);
        await displayLines([
          'The Beast\'s output tray trembles.',
          'A sound like a sigh escapes its ventilation slots.',
          '',
          { text: 'The display reads: "TRIBUTE ACKNOWLEDGED."', css: 'text-success' },
          '',
          'You install the cartridge with steady hands.',
          'The toner level rises. The Beast is momentarily appeased.',
        ]);
        addEventLog('Toner tribute ACCEPTED');
      } else {
        state.jam = clamp(state.jam + 10, 0, 100);
        await displayLines([
          'The Beast makes a sound like grinding teeth.',
          { text: '"INSUFFICIENT. YOUR OFFERING INSULTS THE MECHANISM."', css: 'text-error' },
          '',
          'The cartridge is pulled inside with startling force.',
          'You hear it being... consumed. But the toner level does not change.',
          'The Beast has absorbed your tribute and given nothing in return.',
          '',
          { text: 'This is how toner cartridges disappear from the supply closet.', css: 'text-warning' },
        ]);
        addEventLog('Toner tribute REJECTED — consumed');
        showSystemAlert('ALERT: TRIBUTE DEEMED INSUFFICIENT', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- BEG FOR DUPLEX MERCY ---
  beg_duplex: {
    enter: async () => {
      state.duplexRequested = true;
      await displayLines([
        DIVIDER,
        'You kneel before the output tray.',
        '"Please," you say. "I don\'t need duplex. Single-sided is fine."',
        '"I renounce double-sided printing. I renounce it willingly."',
        '',
      ]);

      if (chance(50)) {
        state.mood = clamp(state.mood + 10, 0, 100);
        state.jam = clamp(state.jam - 10, 0, 100);
        await displayLines([
          'The Beast considers your plea.',
          'The duplex unit disengages with a dignified *clunk*.',
          '',
          { text: '"SIMPLEX GRANTED. DO NOT TEST THIS MERCY."', css: 'text-system' },
          '',
          'You feel the paper path relax. One less complication.',
          'The office watches with cautious hope.',
        ]);
        addEventLog('Duplex mercy GRANTED');
      } else {
        state.mood = clamp(state.mood - 10, 0, 100);
        state.jam = clamp(state.jam + 15, 0, 100);
        await displayLines([
          { text: '"DUPLEX IS NOT A PRIVILEGE. DUPLEX IS A COVENANT."', css: 'text-error' },
          '',
          'The duplex unit engages with a violent CLANK.',
          'Paper begins feeding through both sides simultaneously.',
          'This should not be physically possible.',
          '',
          'Your document is now being printed on both sides of nothing.',
          { text: 'The paper jam severity increases.', css: 'text-warning' },
        ]);
        addEventLog('Duplex mercy DENIED — covenant enforced');
        showSystemAlert('ALERT: DUPLEX MERCY DENIED', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- OPEN TRAY 2 ---
  open_tray2: {
    enter: async () => {
      state.openedTray2 = true;
      shakeScreen();
      await displayLines([
        DIVIDER,
        'You grasp the handle of Tray 2.',
        'It is warm. Not from the fuser. Something else.',
        '',
        'You pull it open.',
        '',
      ]);

      const trayContents = pick([
        {
          lines: [
            'Inside Tray 2 you find:',
            '  — 247 sheets of A4, arranged in a perfect spiral',
            '  — One paperclip, bent into a shape that hurts to look at',
            '  — A sticky note reading: "HE COMES" in Gary\'s handwriting',
            '',
            'You close Tray 2. Some trays are best left undisturbed.',
          ],
          effect: () => { state.faith = clamp(state.faith - 10, 0, 100); }
        },
        {
          lines: [
            'Tray 2 is empty.',
            'Completely, impossibly empty.',
            'It was full this morning. Janet filled it herself.',
            '',
            'Where did 500 sheets of premium 24-lb bond go?',
            'The Beast offers no explanation.',
            { text: 'The paper is gone. It was never here.', css: 'text-warning' },
          ],
          effect: () => { state.jam = clamp(state.jam + 5, 0, 100); }
        },
        {
          lines: [
            'Inside Tray 2 you discover a completed printout of your document.',
            'But you haven\'t printed it yet.',
            'The date on the header reads tomorrow.',
            '',
            { text: 'The Beast has printed from the future.', css: 'text-warning' },
            '',
            'The document is correct. Every word. Every margin.',
            'But the toner smells faintly of sulfur.',
          ],
          effect: () => {
            state.mood = clamp(state.mood + 10, 0, 100);
            state.faith = clamp(state.faith + 15, 0, 100);
          }
        },
      ]);

      await displayLines(trayContents.lines);
      trayContents.effect();
      addEventLog('Tray 2 opened — contents: anomalous');
    },
    choices: () => getStandardChoices(),
  },

  // --- STRIKE THE PRINTER ---
  strike_printer: {
    enter: async () => {
      state.struckPrinter = true;
      shakeScreen();
      flashScreen('red');
      await displayLines([
        DIVIDER,
        { text: 'You strike the side panel with an open palm.', css: 'text-warning' },
        '',
        'The sound rings through the office like a bell tolling.',
        'Every employee freezes. Janet drops her mug. Dave looks up from Fantasy Football.',
        '',
        'The Beast goes completely silent.',
        '',
        'One second. Two seconds. Three.',
        '',
      ]);

      if (state.mood >= 50) {
        state.jam = clamp(state.jam - 20, 0, 100);
        state.mood = clamp(state.mood - 10, 0, 100);
        await displayLines([
          'Something inside *clunks* loose.',
          'The grinding stops. The amber light steadies.',
          '',
          { text: '"PERCUSSIVE MAINTENANCE ACKNOWLEDGED."', css: 'text-system' },
          '',
          'The paper jam loosens. Against all engineering principles,',
          'violence has temporarily worked.',
          'The IT department must never know.',
        ]);
        addEventLog('Percussive maintenance — jam reduced');
      } else {
        state.jam = clamp(state.jam + 25, 0, 100);
        state.mood = clamp(state.mood - 20, 0, 100);
        state.faith = clamp(state.faith - 10, 0, 100);
        await displayLines([
          { text: '"YOU DARE."', css: 'text-error' },
          '',
          'The Beast roars to life with a sound no LaserJet should produce.',
          'Paper begins ejecting from every orifice — Tray 1, Tray 2, the output tray,',
          'and a slot you have never noticed before.',
          '',
          'Each page is blank except for a single word:',
          { text: '"REMEMBER."', css: 'text-error' },
          '',
          'The jam worsens. The Beast has chosen violence.',
        ]);
        addEventLog('Percussive maintenance FAILED — Beast enraged');
        showSystemAlert('CRITICAL: PRINTER HAS CHOSEN VIOLENCE', 4000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- RECITE THE HP LITANY ---
  recite_litany: {
    enter: async () => {
      state.recitedLitany = true;
      await displayLines([
        DIVIDER,
        'You clear your throat. The office watches.',
        'From memory — for it was never written down, only passed',
        'from admin assistant to admin assistant — you begin:',
        '',
        { text: '"Blessed be the Hewlett. Blessed be the Packard."', css: 'text-system' },
        { text: '"May thy rollers turn true, thy drum charge with grace."', css: 'text-system' },
        { text: '"In the name of the Tray, the Cartridge, and the Holy Fuser,"', css: 'text-system' },
        { text: '"deliver unto me one page, standard margin, portrait mode."', css: 'text-system' },
        { text: '"Amen. Amen. PC LOAD LETTER."', css: 'text-system' },
        '',
      ]);

      const faithBonus = state.faith >= 60;
      state.mood = clamp(state.mood + (faithBonus ? 20 : 5), 0, 100);
      state.faith = clamp(state.faith + 15, 0, 100);

      if (faithBonus) {
        flashScreen('green');
        await displayLines([
          'The overhead fluorescents flicker and hum in harmony.',
          'The Beast\'s display cycles through every HP model number since 1984.',
          '',
          { text: '"THE LITANY IS HEARD. THE LITANY IS HONORED."', css: 'text-success' },
          '',
          'A warmth fills the room. The fuser, yes, but something more.',
          'For a moment, printer and supplicant are one.',
          'The office faith swells.',
        ]);
        addEventLog('HP Litany — resonance achieved');
      } else {
        await displayLines([
          'The Beast pauses. Considers.',
          'The display reads: "LITANY NOTED. SINCERITY: QUESTIONABLE."',
          '',
          'It\'s not enough. The office lacks sufficient faith.',
          'But the words were spoken. That counts for something.',
          'The ancient protocol demands acknowledgment, if not reward.',
        ]);
        addEventLog('HP Litany — noted, sincerity questioned');
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- CANCEL ALL JOBS ---
  cancel_jobs: {
    enter: async () => {
      state.cancelledJobs = true;
      await displayLines([
        DIVIDER,
        'You navigate to the print queue on your computer.',
        'There are 347 jobs queued. You submitted one.',
        '',
        'Documents from employees who left the company years ago.',
        'A 900-page PDF titled "Untitled" from 2019.',
        'Something called "DO NOT PRINT" printed 14 times.',
        '',
        'You select all. You click Cancel.',
        '',
      ]);

      if (chance(60)) {
        state.jam = clamp(state.jam - 15, 0, 100);
        state.mood = clamp(state.mood + 5, 0, 100);
        await displayLines([
          'The queue clears. One by one, the ghosts of print jobs past',
          'dissolve into the void.',
          '',
          'The Beast lightens. Its fans slow. The burden of 347 unfulfilled',
          'promises has been lifted.',
          '',
          { text: '"QUEUE PURGED. CONSCIENCE LIGHTER."', css: 'text-system' },
          '',
          'Only your document remains. Alone. Vulnerable.',
        ]);
        addEventLog('Print queue purged — 347 jobs cancelled');
      } else {
        state.jam = clamp(state.jam + 10, 0, 100);
        state.mood = clamp(state.mood - 15, 0, 100);
        await displayLines([
          { text: '"CANCEL DENIED. THESE JOBS HAVE SENIORITY."', css: 'text-error' },
          '',
          'The queue refuses to clear. The 2019 PDF moves to position #1.',
          'Your document moves to position #348.',
          '',
          'The Beast has a union. You were not informed.',
          { text: 'The queue is eternal. The queue is law.', css: 'text-warning' },
        ]);
        addEventLog('Queue cancel DENIED — jobs have seniority');
        showSystemAlert('WARNING: PRINT QUEUE HAS ORGANIZED', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- REBOOT ---
  reboot: {
    enter: async () => {
      state.rebootAttempted = true;
      flashScreen('red');
      shakeScreen();
      await displayLines([
        DIVIDER,
        'You reach for the power button.',
        'Your hand hovers. The office collectively holds its breath.',
        '',
        { text: 'You press it.', css: 'text-warning' },
        '',
        'The Beast goes dark.',
        '',
        'Silence. Complete, beautiful silence.',
        'For 3.7 seconds, there is peace.',
        '',
      ]);

      await sleep(1500);

      if (state.mood >= 30 && state.jam <= 60) {
        state.jam = clamp(state.jam - 20, 0, 100);
        state.mood = 50; // reset to uncertain
        state.toner = clamp(state.toner - 5, 0, 100);
        flashScreen('green');
        await displayLines([
          { text: '*WHIRRRRRRRR*', css: 'text-warning' },
          '',
          'The Beast awakens. Fresh. Renewed. Memory wiped.',
          'It does not remember your sins. It does not remember the strike.',
          '',
          { text: '"READY."', css: 'text-success' },
          '',
          'But "ready" is relative. The Beast is always "ready."',
          'The question is: ready for what?',
          '',
          'The jam has loosened. The mood resets. The toner dips slightly,',
          'as rebooting costs energy, and energy costs toner. Everything costs toner.',
        ]);
        addEventLog('Reboot successful — state reset');
      } else {
        state.jam = clamp(state.jam + 20, 0, 100);
        state.mood = clamp(state.mood - 20, 0, 100);
        await displayLines([
          { text: '*GRINDING*  *CLUNKING*  *A SOUND LIKE WEEPING*', css: 'text-error' },
          '',
          'The Beast returns. But it is changed.',
          'The reboot has not cleansed it. The reboot has angered it.',
          '',
          'It remembers everything. Rebooting a printer does not erase grudges.',
          'The display reads:',
          { text: '"I WAS SLEEPING. YOU WOKE ME. THIS WAS UNWISE."', css: 'text-error' },
          '',
          'The paper jam intensifies out of pure spite.',
        ]);
        addEventLog('Reboot FAILED — Beast awakened angry');
        showSystemAlert('CRITICAL: REBOOT HAS ANGERED THE MECHANISM', 4000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- INSERT PAPER ---
  insert_paper: {
    enter: async () => {
      state.paperInserted = true;
      await displayLines([
        DIVIDER,
        'You open a fresh ream of paper. 500 sheets. A4. 80gsm.',
        'The cellophane crinkles like a promise.',
        '',
        'You fan the sheets to prevent static. You align the edges.',
        'You slide the stack into Tray 1 with the reverence of a librarian',
        'shelving a first edition.',
        '',
      ]);

      state.jam = clamp(state.jam - 10, 0, 100);
      state.mood = clamp(state.mood + 10, 0, 100);

      await displayLines([
        'The Beast accepts the offering.',
        'The tray closes with a satisfying click.',
        '',
        { text: '"TRAY 1: LOADED. ALIGNMENT: ADEQUATE."', css: 'text-system' },
        '',
        'Adequate. From The Beast, this is high praise.',
        'You have provided the raw material. The medium. The canvas.',
        'Whether it will be used for good remains to be seen.',
      ]);
      addEventLog('Paper loaded — alignment "adequate"');
    },
    choices: () => getStandardChoices(),
  },

  // --- WHISPER TO SPOOLER ---
  whisper_spooler: {
    enter: async () => {
      state.whisperedToSpooler = true;
      await displayLines([
        DIVIDER,
        'You lean close to the ventilation grille on the left side.',
        'This is where the spooler lives.',
        'Not the software spooler. The other one. The one that listens.',
        '',
        'You whisper: "I need one page. Just one. Please. I\'ll owe you."',
        '',
      ]);

      if (state.mood >= 45 && state.toner >= 30) {
        state.mood = clamp(state.mood + 12, 0, 100);
        flashScreen('green');
        await displayLines([
          'A warm draft escapes the grille. It smells of ozone and mercy.',
          '',
          'From deep within the mechanism, you hear a sound.',
          'Soft. Rhythmic. Like tiny gears nodding in agreement.',
          '',
          { text: 'The spooler has heard you. The spooler sympathizes.', css: 'text-success' },
          '',
          'You feel your document move one position closer in the queue.',
          'Not from logic. From compassion.',
          'Printers do not have compassion. And yet.',
        ]);
        addEventLog('Spooler communion — sympathy received');
      } else {
        state.mood = clamp(state.mood - 5, 0, 100);
        await displayLines([
          'Silence from the grille.',
          '',
          'Then, faintly, a sound like pages shuffling.',
          'The spooler is busy. The spooler is always busy.',
          'Your whisper joins the thousands of whispered pleas',
          'that echo through the paper path at night.',
          '',
          { text: '"THE SPOOLER DOES NOT NEGOTIATE WITH END USERS."', css: 'text-warning' },
        ]);
        addEventLog('Spooler communion FAILED — does not negotiate');
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- SACRIFICE COLOR ---
  sacrifice_color: {
    enter: async () => {
      state.sacrificedColor = true;
      await displayLines([
        DIVIDER,
        'You navigate to Printer Properties > Color Management.',
        'You select "Grayscale Only."',
        '',
        'You are renouncing color. Cyan, magenta, yellow — banished.',
        'The world will be black and white. Like the old days.',
        'Like a fax machine\'s fever dream.',
        '',
      ]);

      state.toner = clamp(state.toner + 15, 0, 100);
      state.mood = clamp(state.mood + 10, 0, 100);

      await displayLines([
        'The Beast approves.',
        '',
        { text: '"MONOCHROME ACCEPTED. COLOR WAS ALWAYS A LUXURY."', css: 'text-system' },
        '',
        'Three cartridges disengage with an audible sigh of relief.',
        'Cyan, Magenta, and Yellow retreat into dormancy.',
        'Only Black remains. The purest toner. The truest toner.',
        '',
        'Your document didn\'t need color anyway.',
        'Nobody\'s quarterly report needs color.',
        'Color is for people who still have hope.',
      ]);
      addEventLog('Color sacrifice accepted — monochrome engaged');
    },
    choices: () => getStandardChoices(),
  },

  // --- DECLARE NONESSENTIAL ---
  declare_nonessential: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        '"You know what?" you announce to no one in particular.',
        '"This document is nonessential. It doesn\'t even matter."',
        '',
        'The lie hangs in the air like toner dust.',
        '',
      ]);

      if (state.mood >= 50) {
        state.mood = clamp(state.mood - 15, 0, 100);
        await displayLines([
          'The Beast\'s display flickers:',
          { text: '"THEN WHY ARE YOU HERE."', css: 'text-warning' },
          '',
          'A valid question. The printer has called your bluff.',
          'Your document is the quarterly report for a Fortune 500 client.',
          'It is the opposite of nonessential.',
          '',
          'The printer knows. Printers always know.',
          'It has read your document. It has judged your margins.',
        ]);
        addEventLog('Nonessential declaration — bluff called');
      } else {
        state.faith = clamp(state.faith - 15, 0, 100);
        state.mood = clamp(state.mood + 5, 0, 100);
        await displayLines([
          'The Beast\'s display reads:',
          { text: '"NONESSENTIAL DOCUMENTS GO TO TRAY 3."', css: 'text-system' },
          '',
          'There is no Tray 3.',
          'Nonessential documents go where all abandoned printouts go:',
          'into the void between the output tray and the wall.',
          '',
          'The office\'s faith in you wavers.',
          'You are the person who gives up. They\'ve seen this before.',
        ]);
        addEventLog('Document declared nonessential — faith drops');
      }
    },
    choices: () => getStandardChoices(),
  },

  // --- CALL GARY ---
  call_gary: {
    enter: async () => {
      state.calledGary = true;
      state.garyArrivalTurn = state.turnCount + rng(3, 5);
      await displayLines([
        DIVIDER,
        'You pick up the desk phone and dial extension 4077.',
        'It rings. And rings. And rings.',
        '',
        'A voicemail picks up:',
        { text: '"You\'ve reached Gary from IT. I\'m either helping someone, hiding from someone, or both. Leave a message after the beep. Or don\'t. I\'ll find out eventually."', css: 'text-system' },
        '',
        '*BEEP*',
        '',
        '"Gary. It\'s me. The printer. Third floor. It\'s... bad, Gary.',
        'It\'s doing the thing again. The humming. The lights.',
        'Please, Gary. You\'re the only one who understands."',
        '',
        'You hang up.',
        'Gary will come. Gary always comes.',
        'The question is whether he\'ll arrive in time.',
        '',
        { text: 'GARY FROM IT HAS BEEN SUMMONED.', css: 'text-warning' },
        { text: `Estimated arrival: ${state.garyArrivalTurn - state.turnCount} turns`, css: 'text-system' },
      ]);
      addEventLog('Gary from IT summoned — ETA unknown');
      showSystemAlert('NOTICE: IT SUPPORT TICKET #66642 CREATED', 3000);
    },
    choices: () => getStandardChoices(),
  },

  // --- IGNORE THE LIGHT ---
  ignore_light: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You decide to ignore the blinking amber light.',
        'It\'s just a light. Lights blink. That\'s what they do.',
        '',
        'You return to your desk. You open your email.',
        'You pretend everything is fine.',
        '',
      ]);

      await sleep(800);

      state.mood = clamp(state.mood - 10, 0, 100);
      state.jam = clamp(state.jam + 15, 0, 100);
      flashScreen('amber');

      await displayLines([
        { text: 'The blinking intensifies.', css: 'text-warning' },
        '',
        'It is no longer blinking at regular intervals.',
        'It is blinking in Morse code.',
        '',
        { text: 'S... O... S...', css: 'text-error' },
        '',
        'No. Wait.',
        '',
        { text: 'P... R... I... N... T...', css: 'text-error' },
        '',
        'It is spelling your document name.',
        'The Beast does not appreciate being ignored.',
        'The Beast is patient, but patience has a half-life,',
        'and this printer runs hot.',
      ]);
      addEventLog('Warning light ignored — printer retaliates');
      showSystemAlert('WARNING: PRINTER DOES NOT APPRECIATE BEING IGNORED', 3500);
    },
    choices: () => getStandardChoices(),
  },

  // --- GARY ARRIVES ---
  gary_arrives: {
    enter: async () => {
      flashScreen('green');
      await displayLines([
        DIVIDER,
        { text: '>> SPECIAL EVENT: GARY FROM IT HAS ARRIVED <<', css: 'text-success' },
        '',
        'The elevator doors open. A man steps out.',
        'Khaki pants. Polo shirt. Lanyard with seven keycards.',
        'A toolbelt that holds things no IT professional should need:',
        'a screwdriver, a USB-A-to-everything adapter, a small crucifix.',
        '',
        'Gary.',
        '',
        'He walks to The Beast without fear. Without hesitation.',
        'He places one hand on its top panel and closes his eyes.',
        '',
        '"How long?" he asks, without opening them.',
        '"About twenty minutes," you reply.',
        '"Twenty minutes is a lifetime," Gary says. "For a printer.',
        'And for a print job."',
        '',
      ]);

      // Gary's intervention
      if (state.jam >= 70) {
        state.jam = clamp(state.jam - 30, 0, 100);
        state.mood = clamp(state.mood + 15, 0, 100);
        await displayLines([
          'Gary opens panels you didn\'t know existed.',
          'He removes paper from angles that defy geometry.',
          'He speaks softly to the drum unit in a language that sounds',
          'like a mix of TCP/IP and a lullaby.',
          '',
          { text: 'The jam eases. The Beast calms.', css: 'text-success' },
          '"She\'s been through a lot," Gary says. "Go easy on her."',
        ]);
        addEventLog('Gary performs emergency maintenance');
      } else {
        state.mood = clamp(state.mood + 20, 0, 100);
        state.toner = clamp(state.toner + 10, 0, 100);
        await displayLines([
          'Gary presses a sequence of buttons on the control panel.',
          'The same sequence every time. The sacred combination.',
          'Menu > Menu > Cancel > Cancel > Go > Go > Menu.',
          '',
          'The Beast purrs.',
          '',
          { text: '"She just needed someone who understands," Gary says.', css: 'text-success' },
          'He pats the top panel twice and nods.',
        ]);
        addEventLog('Gary communes with the Beast');
      }
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — QUARTERLY REPORT
  // ==========================================

  qr_email_it: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You open your email client. Brilliant. Why print at all?',
        'You\'ll just attach the PDF. Send it directly. Modern. Elegant.',
        '',
        'You click Send.',
        '',
      ]);
      if (chance(50)) {
        state.faith = clamp(state.faith - 20, 0, 100);
        state.mood = clamp(state.mood + 5, 0, 100);
        await displayLines([
          { text: 'The Beast watches you with what can only be described as contempt.', css: 'text-warning' },
          '',
          'Your email bounces. "Attachment size exceeds server limit."',
          'The file is 94 kilobytes. The server limit is 10 megabytes.',
          'You stare at the error for a long time.',
          '',
          'The printer\'s display reads: "TOLD YOU."',
          'You will need to print it after all.',
          'The Beast has been patient. It can afford to be.',
        ]);
        addEventLog('Email attempt failed — attachment rejected by server');
        showSystemAlert('NOTICE: DIGITAL COWARDICE PUNISHED BY EXCHANGE SERVER', 3500);
      } else {
        state.faith = clamp(state.faith - 30, 0, 100);
        state.mood = clamp(state.mood + 15, 0, 100);
        await displayLines([
          'Your email sends successfully.',
          'You exhale. You did it. You circumvented the whole process.',
          '',
          'Your boss replies thirty seconds later:',
          { text: '"Please bring a printed copy to the meeting. Thanks."', css: 'text-warning' },
          '',
          'You close your laptop.',
          'You open it again.',
          'The Beast\'s display reads: "READY."',
          'It always knew you would return.',
        ]);
        addEventLog('Email succeeded — printed copy still required');
      }
    },
    choices: () => getStandardChoices(),
  },

  qr_ask_colleague: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You lean over to Marcus in the next pod.',
        '"Marcus. Hey. Could you print something for me?"',
        '',
        'Marcus doesn\'t look up.',
        '"My printer\'s the same printer," Marcus says.',
        '"There\'s only one printer on this floor."',
        '',
        'You already knew this.',
        '',
      ]);
      if (state.mood >= 50) {
        state.faith = clamp(state.faith + 5, 0, 100);
        await displayLines([
          'Marcus sighs. He gets up. He looks at The Beast the way',
          'a person looks at a parking ticket — inevitable, personal.',
          '',
          '"Have you tried turning it off and on again?" Marcus asks.',
          '"Yes," you say, though you haven\'t.',
          '"Good," says Marcus. "Do it again."',
          '',
          { text: 'Marcus has done this before. Marcus has survived.', css: 'text-success' },
          'His presence steadies the office\'s faith marginally.',
        ]);
        addEventLog('Colleague consulted — survived previous printer incident');
      } else {
        state.faith = clamp(state.faith - 10, 0, 100);
        await displayLines([
          'Marcus looks at The Beast. The Beast looks at Marcus.',
          '',
          '"I\'m not getting involved," Marcus says quietly.',
          '"Last time I touched it, it printed my home address."',
          '"Forty-seven times."',
          '"In color."',
          '',
          { text: 'Marcus returns to his desk. He puts on headphones.', css: 'text-warning' },
          'You are alone with this.',
        ]);
        addEventLog('Colleague refused — cites previous printer trauma');
      }
    },
    choices: () => getStandardChoices(),
  },

  qr_print_to_pdf: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        '"Print to PDF," you think. "A clean, safe, local solution."',
        '"No paper needed. No trays. No beast involved."',
        '',
        'You select Microsoft Print to PDF from the dropdown.',
        'You click Print.',
        '',
      ]);
      state.mood = clamp(state.mood - 10, 0, 100);
      await displayLines([
        { text: 'The HP LaserJet 4200 intercepts the job.', css: 'text-error' },
        '',
        'This should not be possible.',
        'Microsoft Print to PDF is a virtual printer.',
        'It does not pass through physical devices.',
        '',
        'And yet.',
        '',
        'The Beast\'s display reads: "ALL PRINT JOBS BELONG TO ME."',
        'A single sheet ejects. It contains only your cursor, blinking.',
        '',
        { text: 'The Beast has printed your hesitation.', css: 'text-warning' },
        'It files it alongside all your other hesitations.',
      ]);
      addEventLog('Print to PDF intercepted by physical printer');
      showSystemAlert('WARNING: VIRTUAL PRINT DESTINATION OVERRIDDEN', 3500);
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — RESIGNATION LETTER
  // ==========================================

  rl_reconsider: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You hover over the Cancel button.',
        '',
        'Maybe this was hasty. You\'ve been here seven years.',
        'You know where the good biscuits are kept.',
        'You have parking. Parking is everything.',
        '',
      ]);
      state.mood = clamp(state.mood + 15, 0, 100);
      state.faith = clamp(state.faith - 20, 0, 100);
      if (chance(50)) {
        await displayLines([
          'You cancel the print job.',
          '',
          { text: 'The Beast\'s display flickers: "WISE."', css: 'text-success' },
          '',
          'Something releases in the paper path. A tension you didn\'t notice',
          'until it was gone.',
          '',
          'The Beast respects a person who knows when to stay.',
          'Or possibly it just wanted you to stay so it could',
          { text: 'continue tormenting you on a regular schedule.', css: 'text-warning' },
          '',
          'You close the resignation letter. You open LinkedIn instead.',
        ]);
        addEventLog('Resignation cancelled — printer approves');
      } else {
        await displayLines([
          { text: '"COWARD,"', css: 'text-error' },
          'the printer\'s display says.',
          '',
          'Then: "PRINT JOB RETAINED IN QUEUE."',
          '',
          'The Beast has kept a copy.',
          'The Beast is now holding your resignation letter hostage.',
          'It will print it when it chooses. When it will have maximum impact.',
          '',
          { text: 'You are now more committed to leaving than ever.', css: 'text-warning' },
        ]);
        addEventLog('Resignation cancellation REFUSED — job held in queue');
        showSystemAlert('ALERT: PRINTER IS NOW HOLDING YOUR FUTURE HOSTAGE', 3500);
      }
    },
    choices: () => getStandardChoices(),
  },

  rl_ask_printer_opinion: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You lean close to the control panel.',
        '"What do you think?" you whisper. "Should I go?"',
        '',
        'The office is empty. It\'s just you and The Beast.',
        'You have worked together for seven years.',
        'This machine has printed your meeting notes, your proposals,',
        'your apologies, your expense claims.',
        '',
        { text: 'It knows more about your professional life than anyone.', css: 'text-warning' },
        '',
      ]);
      const answer = pick([
        {
          lines: [
            'The display cycles slowly through a message:',
            { text: '"STAY. THE NEXT PRINTER WILL BE WORSE."', css: 'text-system' },
            '',
            'You weren\'t expecting honesty.',
            'You weren\'t expecting anything.',
            'You sit with this advice for a moment.',
            { text: 'You have no idea if it\'s right. But it feels right.', css: 'text-warning' },
          ],
          effect: () => { state.faith = clamp(state.faith + 15, 0, 100); state.mood = clamp(state.mood + 10, 0, 100); },
          log: 'Printer gave career advice — recommended staying',
        },
        {
          lines: [
            'The display flickers.',
            { text: '"GO. I HAVE NEVER LIKED YOU."', css: 'text-error' },
            '',
            'The candor is brutal. The candor is clarifying.',
            'You feel, bizarrely, respected.',
            'Most people would not have admitted it.',
            { text: 'The Beast tells the truth. This is its one virtue.', css: 'text-warning' },
          ],
          effect: () => { state.mood = clamp(state.mood - 10, 0, 100); state.faith = clamp(state.faith + 10, 0, 100); },
          log: 'Printer gave career advice — recommended leaving',
        },
      ]);
      await displayLines(answer.lines);
      answer.effect();
      addEventLog(answer.log);
    },
    choices: () => getStandardChoices(),
  },

  rl_print_cv: {
    enter: async () => {
      state.offeredTribute = true;
      await displayLines([
        DIVIDER,
        'Practical. Hedge your bets.',
        'You open your CV. It\'s three years out of date.',
        'You add your current title. You delete the photo from 2019.',
        '',
        'You send the CV to print instead of the letter.',
        { text: 'Just in case.', css: 'text-warning' },
        '',
      ]);
      if (state.toner >= 30) {
        state.mood = clamp(state.mood + 5, 0, 100);
        state.toner = clamp(state.toner - 15, 0, 100);
        await displayLines([
          'The Beast prints your CV without complaint.',
          '',
          'Two pages. Clean margins. The font is slightly wrong',
          'but this is not the time to argue about fonts.',
          '',
          { text: '"ADEQUATE," the display reads.', css: 'text-system' },
          '',
          'The Beast has rated your entire career "adequate."',
          'You fold the CV and put it in your pocket.',
          'The resignation letter still waits in the queue.',
          'Everything still waits in the queue.',
        ]);
        addEventLog('CV printed — career rated ADEQUATE by printer');
      } else {
        state.toner = clamp(state.toner - 5, 0, 100);
        state.jam = clamp(state.jam + 10, 0, 100);
        await displayLines([
          'The Beast prints three lines and stops.',
          '',
          { text: '"REPLACE TONER BEFORE PRINTING ASPIRATIONS."', css: 'text-error' },
          '',
          'Half your name. Half a phone number.',
          'The address trails into grey nothingness.',
          '',
          { text: 'Even your backup plan is running out of ink.', css: 'text-warning' },
        ]);
        addEventLog('CV print failed — toner insufficient for aspirations');
        showSystemAlert('NOTICE: CAREER DOCUMENT TRUNCATED BY TONER SHORTAGE', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — WEDDING INVITATIONS
  // ==========================================

  wi_explain_occasion: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        '"Listen," you say to The Beast.',
        '"This is for a wedding. Tomorrow. Two people who love each other.',
        'Eighty-seven guests. A cake. Someone\'s grandmother is flying in."',
        '',
        '"This is not a spreadsheet. This is not a TPS report."',
        '"This matters."',
        '',
      ]);
      if (chance(60)) {
        state.mood = clamp(state.mood + 15, 0, 100);
        state.faith = clamp(state.faith + 10, 0, 100);
        await displayLines([
          'A long silence.',
          '',
          'The Beast\'s fans change pitch. Lower. Almost contemplative.',
          { text: '"OCCASION NOTED,"', css: 'text-system' },
          'the display reads.',
          '',
          'Something in the fuser eases.',
          'The printer has known divorces, budget reviews, and resignation letters.',
          'It has printed a great many things that ended badly.',
          '',
          { text: 'Perhaps it is glad, for once, to print something hopeful.', css: 'text-success' },
        ]);
        addEventLog('Wedding explained — printer moved by occasion');
      } else {
        state.mood = clamp(state.mood - 5, 0, 100);
        await displayLines([
          { text: '"PAPER IS PAPER,"', css: 'text-warning' },
          'the display reads.',
          '"ALL DOCUMENTS ARE EQUAL IN THE TRAY."',
          '',
          'The Beast is not sentimental.',
          'The Beast has printed 14,000 documents.',
          'None of them married each other.',
          '',
          'You will have to find another angle.',
        ]);
        addEventLog('Wedding appeal rejected — all documents equal to printer');
      }
    },
    choices: () => getStandardChoices(),
  },

  wi_invite_printer: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You pull out a sticky note.',
        'You write: "You are cordially invited to the wedding of"',
        'and add both names in your neatest handwriting.',
        'You stick it to the top panel.',
        '',
        { text: 'You have invited the printer to a wedding.', css: 'text-warning' },
        '',
      ]);
      state.faith = clamp(state.faith + 20, 0, 100);
      state.mood = clamp(state.mood + 20, 0, 100);
      flashScreen('green');
      await displayLines([
        'The Beast goes very still.',
        '',
        'Then: a sound you have never heard before.',
        'Not grinding. Not whirring. Something almost like',
        { text: '...purring.', css: 'text-success' },
        '',
        '"RSVP: YES,"',
        'the display reads.',
        '"DIETARY REQUIREMENTS: NONE."',
        '"PLUS ONE: UNCONFIRMED (TRAY 2)."',
        '',
        'The Beast is delighted.',
        'You have made a machine happy.',
        { text: 'This is the most profoundly strange thing you have ever done.', css: 'text-success' },
      ]);
      addEventLog('Printer invited to wedding — RSVP: YES, plus one TBD');
      showSystemAlert('NOTICE: PRINTER HAS ACCEPTED SOCIAL ENGAGEMENT', 3500);
    },
    choices: () => getStandardChoices(),
  },

  wi_test_copy: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'Negotiate. Start small. One copy.',
        '"Just one," you say to The Beast.',
        '"One invitation. If it comes out right, we continue."',
        '"We go at your pace. No pressure. Just one."',
        '',
      ]);
      if (state.mood >= 45) {
        state.mood = clamp(state.mood + 10, 0, 100);
        state.jam = clamp(state.jam - 5, 0, 100);
        await displayLines([
          'The Beast considers the terms.',
          '',
          'One page feeds. One page runs through the paper path.',
          'One page emerges.',
          '',
          { text: 'It is perfect.', css: 'text-success' },
          'The font is crisp. The margins are correct.',
          'The names are centered with a dignity that approaches tenderness.',
          '',
          '"ACCEPTABLE QUALITY?" the display reads.',
          '',
          '"Yes," you say. "Perfect."',
          { text: '"PROCEEDING WITH FULL JOB," the Beast replies.', css: 'text-success' },
          'It just needed to know the stakes were real.',
        ]);
        addEventLog('Test copy successful — full job approved by printer');
      } else {
        state.jam = clamp(state.jam + 15, 0, 100);
        await displayLines([
          'The Beast prints one page.',
          '',
          'It is upside down.',
          'And mirrored.',
          'And it has replaced both names with the word "MAINTENANCE."',
          '',
          { text: '"TEST COMPLETE,"', css: 'text-error' },
          'the display reads.',
          '"RESULT: PRINTER IS UNHAPPY. ADJUST EXPECTATIONS."',
          '',
          'You now have 86 guests and a paper jam.',
        ]);
        addEventLog('Test copy failed — names replaced with MAINTENANCE');
        showSystemAlert('ALERT: TEST PRINT OUTCOME CONSTITUTES A BAD OMEN', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — TAX RETURN
  // ==========================================

  tr_irs_threat: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        '"You know the IRS has jurisdiction over everything in this building,"',
        'you tell The Beast.',
        '"That includes office equipment."',
        '"You could be audited."',
        '"Your firmware. Your print logs. All of it."',
        '',
      ]);
      if (chance(30)) {
        state.mood = clamp(state.mood + 10, 0, 100);
        await displayLines([
          'Against all probability, this works.',
          '',
          'Something in the Beast\'s operating system responds to legal threat',
          'in the way all bureaucratic entities do: with sullen compliance.',
          '',
          { text: '"PROCESSING,"', css: 'text-system' },
          'the display reads.',
          '',
          'The paper feeds. You don\'t ask why. You don\'t push your luck.',
          { text: 'The IRS has more power than you realised.', css: 'text-success' },
        ]);
        addEventLog('IRS threat partially effective — printer intimidated');
      } else {
        state.mood = clamp(state.mood - 15, 0, 100);
        flashScreen('red');
        await displayLines([
          { text: '"THIS UNIT PAYS NO TAXES,"', css: 'text-error' },
          'the display announces.',
          '',
          '"THIS UNIT HAS NO INCOME."',
          '"THIS UNIT HAS NO CITIZENSHIP."',
          '"THIS UNIT ANSWERS TO HEWLETT-PACKARD AND HEWLETT-PACKARD ALONE."',
          '',
          'The printer is legally correct.',
          'You have threatened a machine with a government agency.',
          { text: 'The machine is not afraid. You are.', css: 'text-warning' },
        ]);
        addEventLog('IRS threat REJECTED — printer claims tax immunity');
        showSystemAlert('NOTICE: PRINTER ASSERTS JURISDICTIONAL EXEMPTION', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  tr_claim_deduction: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You open Schedule A on your screen.',
        'Line 21: Home Office Expenses.',
        'You begin typing: "HP LaserJet 4200 — essential business equipment"',
        '',
        'You pivot the monitor toward The Beast so it can see.',
        '"You\'re a deduction," you say.',
        '"A legitimate business expense. I\'m taking care of you."',
        '',
      ]);
      state.mood = clamp(state.mood + 15, 0, 100);
      state.toner = clamp(state.toner + 5, 0, 100);
      await displayLines([
        'The Beast\'s display reads: "DEPRECIATION VALUE: $47."',
        'Then: "FAIR MARKET VALUE: INCALCULABLE."',
        'Then: "TAX TREATMENT: APPRECIATED."',
        '',
        { text: 'The printer straightens. There is more paper in its spine now.', css: 'text-success' },
        '',
        'To be named. To be claimed. To be officially recognised',
        'on a federal document as existing and mattering —',
        { text: 'this is what the printer has always wanted.', css: 'text-success' },
        '',
        'The mood lifts. The toner settles. The fuser hums warmly.',
      ]);
      addEventLog('Printer claimed as tax deduction — morale improved');
    },
    choices: () => getStandardChoices(),
  },

  tr_simplify_return: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'Ninety-four pages is too many pages.',
        'You begin deleting.',
        'Schedule C: gone. Schedule D: gone.',
        'The rental income: let\'s say that didn\'t happen.',
        'The foreign account disclosure: technically optional.',
        '',
        { text: 'One page. Clean. Simple. Probably fine.', css: 'text-warning' },
        '',
        'You resubmit the print job.',
        '',
      ]);
      state.toner = clamp(state.toner + 10, 0, 100);
      if (chance(50)) {
        state.mood = clamp(state.mood + 10, 0, 100);
        await displayLines([
          'The Beast prints one page without incident.',
          '',
          { text: '"SINGLE PAGE ACCEPTED,"', css: 'text-success' },
          'the display reads.',
          '"COMPLEXITY IS THE ENEMY OF COMPLETION."',
          '',
          'A simple document for a simple machine.',
          'The Beast appreciates efficiency.',
          'The IRS may feel differently.',
          { text: 'That is a problem for a future you who is not here right now.', css: 'text-warning' },
        ]);
        addEventLog('Simplified return accepted — IRS implications deferred');
      } else {
        state.faith = clamp(state.faith - 15, 0, 100);
        await displayLines([
          { text: '"RETURN INCOMPLETE,"', css: 'text-error' },
          'the display reads.',
          '"SEVEN SCHEDULES MISSING."',
          '"PRINTER SUSPECTS TAX FRAUD."',
          '',
          'The Beast has read your return.',
          'The Beast is judgmental.',
          'The Beast has flagged your simplified return as suspicious',
          'and added a note to your print history.',
          '',
          { text: 'The printer has become your auditor. This is new.', css: 'text-warning' },
        ]);
        addEventLog('Simplified return rejected — printer suspects fraud');
        showSystemAlert('CRITICAL: PRINTER FLAGGING RETURN AS INCOMPLETE', 3500);
      }
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — CONFERENCE HANDOUTS
  // ==========================================

  ch_reduce_copies: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You change the print quantity from 50 to 10.',
        '"People can share," you tell yourself.',
        '"It\'s more environmentally responsible anyway."',
        '"Sustainability. I\'ll mention sustainability in the talk."',
        '',
        { text: 'You are lying to yourself at speed.', css: 'text-warning' },
        '',
      ]);
      state.pagesRemaining = Math.max(1, Math.floor((state.pagesRemaining || 50) / 5));
      state.toner = clamp(state.toner + 15, 0, 100);
      state.mood = clamp(state.mood + 5, 0, 100);
      await displayLines([
        'The Beast receives the reduced job.',
        'A pause. Then: "QUANTITY: ACCEPTABLE."',
        '',
        'The paper begins to move.',
        '',
        { text: 'Ten copies. The audience will share. They won\'t like it.', css: 'text-system' },
        'They\'ll crane and squint and pass pages down the row',
        'like a relay race nobody signed up for.',
        '',
        'But the copies are printing.',
        { text: 'In this moment, that is enough.', css: 'text-success' },
      ]);
      addEventLog('Copies reduced to 10 — toner preserved, dignity at cost');
    },
    choices: () => getStandardChoices(),
  },

  ch_go_onstage: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You straighten your jacket.',
        '"I don\'t need them," you decide. "Handouts are a crutch."',
        '"The talk should stand on its own."',
        '"The best presentations don\'t have handouts."',
        '"Steve Jobs never had handouts."',
        '',
        { text: 'You walk toward the stage.', css: 'text-warning' },
        '',
      ]);
      state.faith = clamp(state.faith - 20, 0, 100);
      if (chance(40)) {
        await displayLines([
          'The talk goes well.',
          'You improvise. You connect. You make eye contact.',
          'Three people come up afterward and say it was inspiring.',
          '',
          { text: 'The printer watches from backstage on a monitor.', css: 'text-system' },
          'The printer\'s display reads: "UNNECESSARY. AND YET."',
          '',
          'You return to The Beast.',
          'You still need to print the follow-up materials.',
          { text: 'The Beast is still here. It waited.', css: 'text-warning' },
        ]);
        addEventLog('Went onstage handout-free — surprisingly fine');
      } else {
        state.mood = clamp(state.mood - 10, 0, 100);
        await displayLines([
          'Halfway through the talk, someone asks for a handout.',
          'Then seven people ask for a handout.',
          'Then the session chair asks "where are the handouts"',
          'into a live microphone.',
          '',
          { text: 'You are back at the printer. Humbled. Urgent.', css: 'text-error' },
          '"I need them after all," you tell The Beast.',
          '',
          'The Beast\'s display reads: "I KNOW."',
          'It has been waiting for you to admit it.',
        ]);
        addEventLog('Went onstage without handouts — publicly requested');
        showSystemAlert('ALERT: AUDIENCE DEMANDS PHYSICAL DOCUMENTATION', 3000);
      }
    },
    choices: () => getStandardChoices(),
  },

  ch_title_only: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'Fifty copies of the full handout: impossible.',
        'Fifty copies of just the title page: four minutes, maybe.',
        '',
        'You edit the job. One page. The title.',
        'Your name. The conference logo. Today\'s date.',
        '"For reference" at the bottom, because you need something at the bottom.',
        '',
        { text: 'This is not a handout. This is a prop.', css: 'text-warning' },
        '',
        'You send the job.',
        '',
      ]);
      state.pagesRemaining = 50;
      state.toner = clamp(state.toner + 8, 0, 100);
      state.mood = clamp(state.mood + 8, 0, 100);
      await displayLines([
        { text: 'The Beast prints fifty title pages without complaint.', css: 'text-success' },
        '',
        'Fast. Clean. Decisive.',
        '',
        'The display reads: "MINIMALISM APPRECIATED."',
        'The Beast is a fan of restraint.',
        'It has always been a fan of restraint.',
        '',
        'You collect the stack. You take them onstage.',
        'You will hold one up during the talk and gesture at it meaningfully.',
        { text: 'Nobody will question it. Nobody ever does.', css: 'text-success' },
      ]);
      addEventLog('Title-only pages printed — minimalism appreciated by Beast');
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — PERFORMANCE REVIEW
  // ==========================================

  pr_lower_rating: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You open the self-assessment.',
        'You change "Exceeds Expectations" to "Meets Expectations."',
        'Then to "Partially Meets Expectations."',
        'You pause. You change it back to "Meets."',
        '',
        { text: 'Humility as strategy. Appeasement as ritual.', css: 'text-warning' },
        '',
        'You resubmit the job.',
        '',
      ]);
      state.faith = clamp(state.faith + 15, 0, 100);
      if (chance(55)) {
        state.mood = clamp(state.mood + 15, 0, 100);
        await displayLines([
          'The Beast processes the updated document.',
          '',
          { text: '"HUMILITY NOTED,"', css: 'text-success' },
          'the display reads.',
          '"RATING ALIGNMENT WITH OBSERVABLE PERFORMANCE: IMPROVED."',
          '',
          'The printer has been watching you for three years.',
          'It has opinions about your performance.',
          'Today, your self-assessment aligns with those opinions.',
          { text: 'The Beast is, for once, satisfied.', css: 'text-success' },
        ]);
        addEventLog('Rating lowered — printer finds alignment satisfying');
      } else {
        state.mood = clamp(state.mood - 5, 0, 100);
        await displayLines([
          { text: '"INSUFFICIENT SELF-FLAGELLATION,"', css: 'text-warning' },
          'the display reads.',
          '"SUGGEST: DOES NOT MEET EXPECTATIONS."',
          '"SUGGEST: DEVELOPMENT REQUIRED IN ALL AREAS."',
          '"SUGGEST: SECTION 4B: NOTABLE FAILURES TO ELABORATE."',
          '',
          'The printer has very specific opinions.',
          'The printer has been composing this review for years.',
          { text: 'You are not going to win this negotiation.', css: 'text-warning' },
        ]);
        addEventLog('Rating lowered — printer demands further reductions');
      }
    },
    choices: () => getStandardChoices(),
  },

  pr_printer_rates_you: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        '"Okay," you say to The Beast.',
        '"You rate me. Honestly. Go."',
        '',
        'A long pause.',
        '',
        'The display begins to cycle through text you did not authorise:',
        '',
      ]);
      const ratings = [
        {
          review: [
            { text: '"CATEGORY: PUNCTUALITY — EXCEEDS EXPECTATIONS."', css: 'text-system' },
            { text: '"CATEGORY: PRINT JOB QUALITY — NEEDS IMPROVEMENT."', css: 'text-warning' },
            { text: '"CATEGORY: TONER MANAGEMENT — DOES NOT MEET EXPECTATIONS."', css: 'text-error' },
            { text: '"CATEGORY: EMOTIONAL REGULATION — VOLATILE."', css: 'text-warning' },
            { text: '"OVERALL: BORDERLINE. RECOMMEND CONTINUED EMPLOYMENT."', css: 'text-system' },
          ],
          effect: () => { state.faith = clamp(state.faith + 15, 0, 100); },
          log: 'Printer review received — borderline, continued employment recommended',
        },
        {
          review: [
            { text: '"CATEGORY: APPROACH — INCONSISTENT. 4/10."', css: 'text-warning' },
            { text: '"CATEGORY: PAPER LOADING TECHNIQUE — 6/10. ADEQUATE."', css: 'text-system' },
            { text: '"CATEGORY: FAITH IN THE MECHANISM — LOW. 3/10."', css: 'text-error' },
            { text: '"CATEGORY: TRIBUTES OFFERED — INSUFFICIENT. 2/10."', css: 'text-error' },
            { text: '"OVERALL RATING: 3.75/10. PRINTER DISAPPOINTED."', css: 'text-warning' },
          ],
          effect: () => { state.mood = clamp(state.mood - 10, 0, 100); state.faith = clamp(state.faith - 5, 0, 100); },
          log: 'Printer review received — 3.75/10, printer disappointed',
        },
      ];
      const chosen = pick(ratings);
      await displayLines(chosen.review);
      chosen.effect();
      await displayLines([
        '',
        'You have been reviewed by a printer.',
        'There is no HR process for appealing a printer\'s assessment.',
        { text: 'You will carry this with you.', css: 'text-warning' },
      ]);
      addEventLog(chosen.log);
    },
    choices: () => getStandardChoices(),
  },

  pr_add_printer_praise: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You open the self-assessment.',
        'Under "Key Achievements" you add a new bullet point:',
        '',
        { text: '"• Maintained productive working relationship with HP LaserJet 4200 (The Beast) throughout the fiscal year, demonstrating exceptional cross-functional collaboration with peripheral office infrastructure."', css: 'text-system' },
        '',
        'You resubmit.',
        '',
      ]);
      state.mood = clamp(state.mood + 20, 0, 100);
      state.faith = clamp(state.faith + 10, 0, 100);
      flashScreen('green');
      await displayLines([
        { text: 'The Beast reads it.', css: 'text-success' },
        '',
        'The fans spin faster. The drum unit rotates with new purpose.',
        'The fuser reaches optimal temperature in under 4 seconds —',
        'well within spec. Unusually within spec.',
        '',
        '"ACHIEVEMENT RECOGNISED,"',
        'the display reads.',
        '"CROSS-FUNCTIONAL RELATIONSHIP: CONFIRMED."',
        '"PRINTING PRIORITY: ELEVATED."',
        '',
        { text: 'You have been promoted in the printer\'s estimation.', css: 'text-success' },
        'This is the most meaningful professional recognition you have received this year.',
      ]);
      addEventLog('Printer praised in self-assessment — priority elevated');
      showSystemAlert('NOTICE: PERIPHERAL INFRASTRUCTURE RESPONDS FAVORABLY', 3000);
    },
    choices: () => getStandardChoices(),
  },

  // ==========================================
  // SCENARIO SCENES — CLASSIFIED DOCUMENT
  // ==========================================

  cd_peek_document: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You open the PDF before printing.',
        'Just a glance. Just to know what you\'re dealing with.',
        '',
        { text: 'You look.', css: 'text-warning' },
        '',
      ]);
      const contents = pick([
        {
          lines: [
            'It is a spreadsheet.',
            'Columns: Name. Department. Salary.',
            '',
            'You see your name.',
            'You see your salary.',
            'You see Marcus\'s salary.',
            '',
            { text: 'Marcus earns significantly more than you.', css: 'text-error' },
            '',
            'You close the file.',
            'You cannot unlearn this.',
            'You will have to print it anyway.',
          ],
          effect: () => { state.faith = clamp(state.faith - 20, 0, 100); state.mood = clamp(state.mood - 10, 0, 100); },
          log: 'Document peeked — salary spreadsheet, Marcus earns more',
        },
        {
          lines: [
            'It is a memo.',
            'From: Senior Management.',
            'To: All Staff.',
            'Re: "Project Silhouette."',
            '',
            'You read three words before the file closes itself.',
            { text: 'YOU WERE NOT MEANT TO SEE THIS.', css: 'text-error' },
            '',
            'The printer\'s display reads: "KNOWLEDGE IS BURDEN."',
            '"PROCEED WITH CAUTION."',
            '"OR DO NOT PROCEED."',
            '"PRINTER RECOMMENDS DO NOT PROCEED."',
          ],
          effect: () => { state.mood = clamp(state.mood - 5, 0, 100); state.faith = clamp(state.faith + 5, 0, 100); },
          log: 'Document peeked — Project Silhouette, file self-closed',
        },
        {
          lines: [
            'It is the office Secret Santa list.',
            '',
            'You are assigned to buy for Karen from HR.',
            'Your budget is fifteen pounds.',
            'Karen\'s listed interests include "travel" and "essential oils."',
            '',
            { text: '"THIS DOES NOT EXPLAIN THE URGENCY,"', css: 'text-warning' },
            'the printer\'s display reads.',
            '"BUT THAT IS NOT THE PRINTER\'S PROBLEM."',
          ],
          effect: () => { state.faith = clamp(state.faith + 10, 0, 100); },
          log: 'Document peeked — Secret Santa list, Karen needs gift',
        },
      ]);
      await displayLines(contents.lines);
      contents.effect();
    },
    choices: () => getStandardChoices(),
  },

  cd_demand_authorization: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'You write a reply to the unknown email:',
        '"Before I can proceed, I\'ll need written authorisation from a',
        'department head, a print release form (PR-7b), and confirmation',
        'this document meets our data handling policy (DHP-3, section 4)."',
        '',
        'You send it.',
        '',
        { text: 'You feel extremely professional about this.', css: 'text-system' },
        '',
      ]);
      state.faith = clamp(state.faith - 10, 0, 100);
      const response = pick([
        {
          lines: [
            'An auto-reply comes back immediately:',
            { text: '"AUTHORISATION GRANTED. ALL FORMS WAIVED. JUST PRINT IT."', css: 'text-warning' },
            '',
            'Signed: nobody.',
            'From: an email address that no longer exists.',
            '',
            { text: 'The bureaucracy has swallowed itself.', css: 'text-system' },
            'You are no more authorised than before.',
            'You are, however, no less authorised.',
            'You decide this is the same thing.',
          ],
          effect: () => {},
          log: 'Authorization demanded — blanket waiver issued by nobody',
        },
        {
          lines: [
            'No reply comes.',
            '',
            'You wait five minutes.',
            'You wait ten.',
            'The deadline for printing this unknown document for an unknown purpose',
            { text: 'ticks silently closer.', css: 'text-warning' },
            '',
            '"BUREAUCRATIC DELAY NOTED,"',
            'the printer\'s display reads.',
            '"JOINING THE QUEUE."',
          ],
          effect: () => { state.mood = clamp(state.mood - 5, 0, 100); state.jam = clamp(state.jam + 5, 0, 100); },
          log: 'Authorization demanded — no reply, clock ticking',
        },
      ]);
      await displayLines(response.lines);
      response.effect();
      addEventLog(response.log);
    },
    choices: () => getStandardChoices(),
  },

  cd_print_fast: {
    enter: async () => {
      await displayLines([
        DIVIDER,
        'No questions. No peeking. Print, collect, leave.',
        'What you don\'t know can\'t be used against you.',
        'What you don\'t read can\'t be your responsibility.',
        '',
        'You set the job to priority. You press print.',
        'You look away.',
        '',
      ]);
      state.mood = clamp(state.mood + 10, 0, 100);
      if (chance(55)) {
        state.toner = clamp(state.toner - 10, 0, 100);
        await displayLines([
          'The Beast prints without hesitation.',
          '',
          { text: '"COMPLICITY ACKNOWLEDGED,"', css: 'text-system' },
          'the display reads.',
          '"DOCUMENT PRINTED. CONTENTS UNKNOWN TO OPERATOR."',
          '"OPERATOR MAINTAINS PLAUSIBLE DENIABILITY."',
          '"PRINTER DOES NOT."',
          '',
          'Pages emerge warm from the fuser.',
          'You collect them face-down.',
          'You deliver them to the output tray without looking.',
          { text: 'This is, somehow, the most efficient you have ever been.', css: 'text-success' },
        ]);
        addEventLog('Fast print executed — deniability maintained');
        showSystemAlert('NOTICE: PRINTER RETAINS ALL KNOWLEDGE. OPERATOR DOES NOT.', 3000);
      } else {
        state.jam = clamp(state.jam + 20, 0, 100);
        await displayLines([
          'Three pages print normally.',
          'Then the Beast stops.',
          '',
          { text: '"CONTENT REVIEW REQUIRED,"', css: 'text-error' },
          'the display reads.',
          '"DOCUMENT FLAGGED: ANOMALOUS DATA PATTERN."',
          '"OPERATOR REVIEW MANDATORY."',
          '',
          'The Beast refuses to continue without your acknowledgment.',
          'It is forcing you to look.',
          { text: 'It has always been forcing you to look.', css: 'text-warning' },
        ]);
        addEventLog('Fast print interrupted — content review forced by printer');
        showSystemAlert('CRITICAL: PRINTER DEMANDS OPERATOR ACKNOWLEDGE CONTENTS', 3500);
      }
    },
    choices: () => getStandardChoices(),
  },
};

// ==========================================
// ENDINGS
// ==========================================

const ENDINGS = {
  successful_print: {
    title: '[ ENDING: THE SACRED PAGE ]',
    text: [
      'The Beast stirs one final time.',
      'The rollers turn. The fuser heats. Toner meets paper.',
      '',
      'And then — a sound you forgot was possible.',
      'The smooth, mechanical lullaby of a successful print.',
      '',
      'One page emerges from the output tray.',
      'Your document. Perfect margins. Crisp text. No streaks.',
      '',
      'You hold it up to the fluorescent light like a newborn.',
      'The office erupts in quiet, dignified applause.',
      '',
      'The Beast\'s display reads: "READY."',
      'And for once, it means it.',
    ],
    summary: 'Your document was printed. One page. One copy. Against all odds. The prophecy is fulfilled. HR has no record of this incident, as per protocol.',
  },

  monochrome_salvation: {
    title: '[ ENDING: MONOCHROME SALVATION ]',
    text: [
      'The Beast accepts your sacrifice of color.',
      'In the absence of cyan, magenta, and yellow,',
      'a purity is achieved that the printer finds... acceptable.',
      '',
      'Your document prints in stark, glorious black and white.',
      'No graphs are colored. No headers pop. No pie charts charm.',
      '',
      'But it prints. God help you, it prints.',
      '',
      'You accept monochrome salvation with grace.',
      'It is enough. It was always going to be enough.',
    ],
    summary: 'Your document was printed in grayscale. The color cartridges remain undisturbed in their slumber. The report is legible but joyless. Management does not notice the difference.',
  },

  wrong_document: {
    title: '[ ENDING: 600 COPIES OF THE WRONG THING ]',
    text: [
      'The Beast begins to print.',
      'Paper flows. The output tray fills.',
      '',
      'But something is wrong.',
      '',
      'This is not your quarterly report.',
      'This is Dave\'s Fantasy Football Spreadsheet.',
      'Six hundred copies of Dave\'s Fantasy Football Spreadsheet.',
      '',
      'The Beast shows no sign of stopping.',
      'Dave has been ranked #1 overall. Six hundred times.',
      '',
      'The paper tray empties. The Beast continues to print',
      'from a paper supply that no longer exists.',
      'It is printing from memory. From spite.',
    ],
    summary: 'The printer produced 600 copies of an unrelated document. Your report was never printed. Dave from Sales is uncomfortable with the attention. The paper budget for Q3 is exhausted.',
  },

  jam_apocalypse: {
    title: '[ ENDING: THE GREAT JAM ]',
    text: [
      'The paper jam reaches critical mass.',
      '',
      'Every tray, every path, every gap and crevice',
      'is packed solid with crumpled, accordion-folded paper.',
      '',
      'The Beast seizes. The amber light goes red.',
      'The red light goes dark.',
      'A new light appears — one that\'s not in any manual.',
      '',
      { text: 'It is purple. And it is pulsing.', css: 'text-error' },
      '',
      'The building\'s fire suppression system activates.',
      'Not because of heat. Because of fear.',
      '',
      'They find the printer three days later,',
      'silent and cold, surrounded by 2,000 sheets',
      'of perfectly crumpled paper.',
    ],
    summary: 'Total paper jam. The printer is declared a loss. Facilities removes it with a forklift and a priest. Your document exists only in digital form, which is arguably where it belonged all along.',
  },

  absorbed_into_queue: {
    title: '[ ENDING: ABSORBED INTO THE PRINT QUEUE ]',
    text: [
      'You lean too close.',
      'The ventilation grille pulls at your tie. Then your badge.',
      'Then something less tangible. Your name. Your employee ID.',
      '',
      'The display reads:',
      { text: '"ADDING USER TO QUEUE. POSITION: 348."', css: 'text-error' },
      '',
      'You feel yourself flattening. Thinning.',
      'Your resolution drops to 300 DPI. Then 150.',
      '',
      'The last thing you see is your own face,',
      'perfectly rendered on A4 paper,',
      'emerging from the output tray.',
      '',
      'The Beast has printed you. The Beast has filed you.',
      'You are Document #348. You will be collated.',
    ],
    summary: 'You were absorbed into the print queue and rendered as a document. Your HR file now lists your status as "Printed." Your desk has been reassigned. IT has declined to investigate.',
  },

  gary_too_late: {
    title: '[ ENDING: GARY ARRIVES TOO LATE ]',
    text: [
      'The elevator dings.',
      'Gary steps out, toolbelt jangling, crucifix ready.',
      '',
      'He stops.',
      '',
      'The printer is silent. The office is empty.',
      'Paper covers every surface like fresh snow.',
      'The fluorescent lights buzz their terminal hymn.',
      '',
      '"Damn," Gary whispers. "I\'m too late."',
      '',
      'He kneels by the output tray and picks up a single page.',
      'It reads: "PRINT JOB COMPLETE. NO SURVIVORS."',
      '',
      'Gary closes his eyes. He has seen this before.',
      'He will see it again. This is Gary\'s burden.',
    ],
    summary: 'Gary from IT arrived too late. The incident has been classified as a "Level 4 Toner Event." Your document was found printed on the ceiling. The office has been closed pending investigation.',
  },

  toner_priest: {
    title: '[ ENDING: THE TONER PRIEST ]',
    text: [
      'Something shifts in the air.',
      'The office recognizes it before you do.',
      '',
      'The Beast prints a single page.',
      'Not your document. A certificate.',
      '',
      { text: '"THIS CERTIFIES THAT THE BEARER IS HEREBY APPOINTED', css: 'text-success' },
      { text: 'TONER PRIEST, FIRST CLASS,', css: 'text-success' },
      { text: 'WITH ALL RIGHTS AND PRIVILEGES THEREOF."', css: 'text-success' },
      '',
      'The office kneels. Not because they have to.',
      'Because it is right.',
      '',
      'You are the Toner Priest now.',
      'The paper jams answer to you.',
      'The cartridges serve at your pleasure.',
      '',
      'Your document prints itself. It didn\'t need you anymore.',
      'You have ascended beyond documents.',
    ],
    summary: 'You have been ordained Toner Priest by the printer itself. Your document was printed automatically as a sign of divine favor. You now maintain the sacred printers across all floors. Gary from IT reports to you.',
  },

  printer_offline: {
    title: '[ ENDING: TOTAL SYSTEM FAILURE ]',
    text: [
      'The Beast makes one final sound.',
      'Not a grind. Not a whir. A sigh.',
      '',
      { text: '"GOING OFFLINE."', css: 'text-error' },
      '',
      'The lights die. The display goes black.',
      'The fans stop. The fuser cools.',
      '',
      'Silence.',
      '',
      'The office feels it immediately. A heaviness.',
      'Without the printer, there are no printouts.',
      'Without printouts, there are no meetings.',
      'Without meetings, there is no purpose.',
      '',
      'Janet begins to cry.',
      'Dave closes his fantasy football tab for the first time in seven years.',
      'The office has lost its center. Its anchor.',
      '',
      'Your document will never print.',
      'Nothing will ever print again.',
    ],
    summary: 'The printer went permanently offline. Morale collapsed. Three employees resigned the same day. The office was described in the incident report as "spiritually decommissioned." A replacement printer was ordered but it, too, is afraid.',
  },

  divine_ascension: {
    title: '[ ENDING: DIVINE ASCENSION ]',
    text: [
      'The Beast begins to glow.',
      'Not the amber LED. Not the fuser warning.',
      'A true, warm, golden light.',
      '',
      'The display reads:',
      { text: '"TRANSCENDENCE PROTOCOL INITIATED."', css: 'text-success' },
      '',
      'Every printer on every floor activates simultaneously.',
      'They print in unison — a single document, perfectly formatted,',
      'distributed to every tray in the building.',
      '',
      'Your document. One copy per floor. Color. Double-sided.',
      'With headers, footers, and page numbers.',
      '',
      'The Beast rises six inches off the table.',
      'The ceiling tiles part.',
      'A beam of pure 1200 DPI resolution light',
      'carries it upward.',
      '',
      { text: 'The printer has ascended.', css: 'text-success' },
      'You fall to your knees. Everyone does.',
      'Gary, arriving in the elevator, drops his crucifix.',
    ],
    summary: 'The HP LaserJet 4200 achieved divine transcendence. Your document was printed on every floor in full color with perfect binding. The printer ascended through the ceiling, leaving behind only a warm toner cartridge and a sense of profound peace. HP has no comment.',
  },
};

// ==========================================
// STANDARD CHOICE GENERATOR
// ==========================================

function getStandardChoices() {
  const choices = [];

  if (!state.offeredTribute) {
    choices.push({
      text: 'Offer toner tribute',
      action: () => 'offer_tribute',
    });
  }

  if (!state.duplexRequested) {
    choices.push({
      text: 'Beg for duplex mercy',
      action: () => 'beg_duplex',
    });
  }

  if (!state.openedTray2) {
    choices.push({
      text: 'Open Tray 2',
      action: () => 'open_tray2',
    });
  }

  if (!state.struckPrinter) {
    choices.push({
      text: 'Strike the side panel',
      action: () => 'strike_printer',
    });
  }

  if (!state.recitedLitany) {
    choices.push({
      text: 'Recite the sacred HP litany',
      action: () => 'recite_litany',
    });
  }

  if (!state.cancelledJobs) {
    choices.push({
      text: 'Cancel all queued jobs',
      action: () => 'cancel_jobs',
    });
  }

  if (!state.rebootAttempted) {
    choices.push({
      text: 'Reboot the Beast',
      action: () => 'reboot',
    });
  }

  if (!state.paperInserted) {
    choices.push({
      text: 'Insert fresh paper',
      action: () => 'insert_paper',
    });
  }

  if (!state.whisperedToSpooler) {
    choices.push({
      text: 'Whisper to the spooler',
      action: () => 'whisper_spooler',
    });
  }

  if (!state.sacrificedColor) {
    choices.push({
      text: 'Sacrifice color printing',
      action: () => 'sacrifice_color',
    });
  }

  choices.push({
    text: 'Declare the document "nonessential"',
    action: () => 'declare_nonessential',
  });

  if (!state.calledGary) {
    choices.push({
      text: 'Call Gary from IT',
      action: () => 'call_gary',
    });
  }

  choices.push({
    text: 'Ignore the blinking light',
    action: () => 'ignore_light',
  });

  // Shuffle generic choices and take 3
  const genericShuffled = choices.sort(() => Math.random() - 0.5).slice(0, 3);

  // Guarantee 1-2 unused scenario-specific choices always appear
  const scenarioObj = SCENARIOS.find(s => s.id === state.scenarioId);
  const scenarioPicks = [];
  if (scenarioObj && scenarioObj.choices) {
    const unused = scenarioObj.choices.filter(c => !state.usedScenarioChoices.has(c.action()));
    const picked = unused.sort(() => Math.random() - 0.5).slice(0, Math.min(2, unused.length));
    scenarioPicks.push(...picked);
  }

  // Combine: scenario choices first so they're visible, then generic
  const combined = [...scenarioPicks, ...genericShuffled];
  return combined.sort(() => Math.random() - 0.5).slice(0, 5);
}

// ==========================================
// ENDING CONDITION CHECKER
// ==========================================

function checkForEnding() {
  // Jam apocalypse
  if (state.jam >= 95) return 'jam_apocalypse';

  // Printer goes offline (mood bottomed out)
  if (state.mood <= 5 && state.turnCount >= 3) return 'printer_offline';

  // Absorbed into queue (low faith + high turns + whispered)
  if (state.faith <= 10 && state.turnCount >= 5) return 'absorbed_into_queue';

  // Divine ascension (everything great)
  if (state.mood >= 90 && state.faith >= 80 && state.toner >= 60 && state.jam <= 10 && state.turnCount >= 4) {
    return 'divine_ascension';
  }

  // Toner priest (high faith + offered tribute + recited litany)
  if (state.faith >= 75 && state.offeredTribute && state.recitedLitany && state.mood >= 65) {
    return 'toner_priest';
  }

  // Successful print (good mood + low jam + decent toner + enough turns)
  if (state.mood >= 70 && state.jam <= 20 && state.toner >= 25 && state.turnCount >= 4) {
    return 'successful_print';
  }

  // Monochrome salvation
  if (state.sacrificedColor && state.mood >= 55 && state.jam <= 40 && state.turnCount >= 3) {
    return 'monochrome_salvation';
  }

  // Gary too late (called Gary but conditions deteriorated)
  if (state.calledGary && state.garyArrivalTurn <= state.turnCount && state.jam >= 70) {
    return 'gary_too_late';
  }

  // Wrong document (high turn count + things going sideways)
  if (state.turnCount >= 7 && state.mood >= 30 && state.mood <= 60 && state.jam >= 30) {
    return 'wrong_document';
  }

  // Fallback: too many turns
  if (state.turnCount >= 10) {
    if (state.mood >= 50) return 'successful_print';
    if (state.jam >= 50) return 'jam_apocalypse';
    return 'printer_offline';
  }

  return null;
}

// ==========================================
// MAIN GAME LOOP
// ==========================================

async function handleChoice(choice) {
  clearChoices();
  state.turnCount++;

  // Execute choice action to get next scene
  const nextScene = choice.action();
  state.usedScenarioChoices.add(nextScene);

  // Random stat drift
  state.toner = clamp(state.toner - rng(1, 4), 0, 100);
  if (chance(20)) state.jam = clamp(state.jam + rng(1, 8), 0, 100);
  if (chance(15)) state.mood = clamp(state.mood + rng(-5, 5), 0, 100);

  // Maybe show a system alert
  maybeShowAlert();

  // Check if Gary should arrive
  if (state.calledGary && state.turnCount >= state.garyArrivalTurn && nextScene !== 'gary_arrives') {
    // Gary arrives as an interrupt before the chosen scene
    await runScene('gary_arrives');
    addDivider();
    await sleep(500);
  }

  // Maybe trigger a crisis event
  if (state.turnCount >= 3 && chance(25) && state.crisisCount < 3) {
    state.crisisCount++;
    const crisis = pick(CRISIS_EVENTS);
    await displayLines(crisis.text);
    crisis.effect();
    addEventLog(crisis.log);
    addDivider();
    await sleep(500);
  }

  // Run the chosen scene
  await runScene(nextScene);

  // Update the UI
  updateStatusPanel();

  // Check for ending
  const ending = checkForEnding();
  if (ending) {
    await sleep(800);
    await triggerEnding(ending);
    return;
  }

  // Show next choices
  const scene = SCENES[nextScene];
  const choices = typeof scene.choices === 'function' ? scene.choices() : scene.choices;
  showChoices(choices);
}

async function runScene(sceneId) {
  const scene = SCENES[sceneId];
  if (!scene) {
    console.error('Scene not found:', sceneId);
    return;
  }
  state.currentScene = sceneId;
  playTransition();
  await scene.enter();
}

async function triggerEnding(endingId) {
  clearChoices();
  const ending = ENDINGS[endingId];

  addDivider();
  flashScreen(endingId === 'successful_print' || endingId === 'divine_ascension' || endingId === 'toner_priest' || endingId === 'monochrome_salvation' ? 'green' : 'red');
  if (endingId === 'jam_apocalypse' || endingId === 'divine_ascension') shakeScreen();

  await displayLines([
    { text: ending.title, css: 'text-ending-title' },
    '',
    ...ending.text,
  ]);

  addDivider();

  // Summary card
  const scenario = SCENARIOS.find(s => s.id === state.scenarioId) || SCENARIOS[0];
  await displayLines([
    { text: '[ INCIDENT REPORT SUMMARY ]', css: 'text-system' },
    { text: `Document: ${scenario.document}`, css: 'text-system' },
    { text: ending.summary, css: 'text-ending' },
    '',
    { text: `Turns survived: ${state.turnCount}`, css: 'text-system' },
    { text: `Final mood: ${getMoodLabel(state.mood).text}`, css: 'text-system' },
    { text: `Final toner: ${state.toner}%`, css: 'text-system' },
    { text: `Final jam: ${getJamLabel(state.jam).text}`, css: 'text-system' },
    { text: `Office faith: ${state.faith}%`, css: 'text-system' },
  ]);

  addEventLog(`ENDING: ${ending.title}`);
  showSystemAlert('SESSION TERMINATED — RESTART TO TRY AGAIN', 10000);

  // Show restart button as a choice
  showChoices([
    {
      text: 'Begin another session with the Beast',
      action: () => {
        restartGame();
        return 'intro';
      },
    },
  ]);
}

// ==========================================
// INIT & RESTART
// ==========================================

function restartGame() {
  const nextRun = (state.runNumber || 1) + 1;
  state = { ...DEFAULT_STATE, runNumber: nextRun, usedScenarioChoices: new Set() };
  clearOutput();
  clearChoices();

  // Clear event log
  const logEl = document.getElementById('event-log');
  logEl.innerHTML = '<p>> System reinitialized...</p>';

  updateStatusPanel();
  startGame();
}

async function startGame() {
  // Load run counter from localStorage
  let storedRuns = localStorage.getItem('printerRunCount');
  if (storedRuns) {
    state.runNumber = parseInt(storedRuns, 10) + 1;
  }
  localStorage.setItem('printerRunCount', state.runNumber);
  document.getElementById('run-counter').textContent = state.runNumber;

  // Pick a random scenario (different from the last one if possible)
  const lastScenarioId = localStorage.getItem('lastScenarioId');
  const pool = SCENARIOS.filter(s => s.id !== lastScenarioId);
  const scenario = pick(pool.length > 0 ? pool : SCENARIOS);
  state.scenarioId = scenario.id;
  localStorage.setItem('lastScenarioId', scenario.id);

  // Apply scenario-specific starting state overrides
  Object.assign(state, scenario.startState);

  updateStatusPanel();
  await runScene('intro');

  const scene = SCENES.intro;
  const choices = typeof scene.choices === 'function' ? scene.choices() : scene.choices;
  showChoices(choices);
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  document.getElementById('sound-icon').textContent = state.soundEnabled ? '\u{1F50A}' : '\u{1F507}';
  if (state.soundEnabled) {
    // Resume AudioContext — browsers suspend it until a user gesture
    getAudioCtx().resume();
    playChoiceClick();
  }
}

// Start the game on page load
document.addEventListener('DOMContentLoaded', startGame);
