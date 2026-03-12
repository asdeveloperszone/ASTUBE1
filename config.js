// ================================================================
// ASTUBE - Firebase Config & Shared Utilities
// ================================================================

const firebaseConfig = {
  apiKey:            "AIzaSyD_2Ma7FdXVAmEjRXXvfPNb9Vvvl3FJLzc",
  authDomain:        "astube-asdeveloper.firebaseapp.com",
  databaseURL:       "https://astube-asdeveloper-default-rtdb.firebaseio.com",
  projectId:         "astube-asdeveloper",
  storageBucket:     "astube-asdeveloper.firebasestorage.app",
  messagingSenderId: "511365641957",
  appId:             "1:511365641957:web:a246b5590e3753e5b7460c",
  measurementId:     "G-KKBPXDL8JD"
};

firebase.initializeApp(firebaseConfig);
const db             = firebase.database();
const auth           = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

window.BACKEND_URL    = null;
window.BACKEND_STATUS = 'checking';

// ── ASTUBE Official Channel ──────────────────────────────────────
// Set this to YOUR Firebase UID (the account you log into as ASTUBE).
// Find it: Firebase Console → Authentication → Users → copy your UID
window.ASTUBE_OFFICIAL_UID = 'vHuiPCnIV1e7rGSUDqCz52ccZpa2';

// ── YouTube Data API v3 Key ──────────────────────────────────────
// Get your key from: https://console.cloud.google.com
// Enable: YouTube Data API v3 → Create API Key
window.YT_API_KEY = 'AIzaSyAdnJhHuZe4c0BRPhEyKb-TxN2lDK41ZXA';


// ================================================================
// USER PHOTO CACHE
// Avoids repeated Firebase reads for the same uid's photo
// ================================================================
const _userPhotoCache = {};

async function getUserPhoto(uid) {
  if (!uid) return '';
  if (_userPhotoCache[uid] !== undefined) return _userPhotoCache[uid];
  try {
    const snap = await db.ref('users/' + uid + '/photoUrl').once('value');
    _userPhotoCache[uid] = snap.exists() ? (snap.val() || '') : '';
  } catch(e) { _userPhotoCache[uid] = ''; }
  return _userPhotoCache[uid];
}

// Pre-warm cache for a list of uids (call after loading videos)
async function warmPhotoCache(uids) {
  const unique = [...new Set(uids.filter(Boolean))];
  await Promise.all(unique.map(uid => getUserPhoto(uid)));
}

// ================================================================
// BACKEND STATUS
// ================================================================

const _BACKEND_CACHE_KEY = 'astube_backend_url';
const _BACKEND_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function isLocalhost() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

async function pingBackend(url) {
  // Try twice — first attempt often fails due to slow DNS on mobile networks
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), attempt === 1 ? 3000 : 6000);
      const res   = await fetch(`${url}/health`, {
        signal: ctrl.signal,
        cache:  'no-store'
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      if (data.status === 'ok') return true;
    } catch(e) {
      if (attempt === 1) {
        // Short pause before retry
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return false;
    }
  }
  return false;
}

// Returns: undefined = no cache, null = cached offline, string = cached URL
function _getCachedBackend() {
  try {
    const raw = sessionStorage.getItem(_BACKEND_CACHE_KEY);
    if (raw === null) return undefined;
    const { url, ts } = JSON.parse(raw);
    if (Date.now() - ts > _BACKEND_CACHE_TTL) {
      sessionStorage.removeItem(_BACKEND_CACHE_KEY);
      return undefined;
    }
    return url; // null = offline, string = online URL
  } catch(e) { return undefined; }
}

function _setCachedBackend(url) {
  try { sessionStorage.setItem(_BACKEND_CACHE_KEY, JSON.stringify({ url, ts: Date.now() })); } catch(e) {}
}

// ── Step 1: Restore from cache INSTANTLY (synchronous, no waiting) ──
// Called immediately so BACKEND_URL is set before any page code runs
function restoreBackendFromCache() {
  const cached = _getCachedBackend();
  if (cached !== undefined) {
    window.BACKEND_URL = cached || null;
    setBackendStatus(cached ? 'online' : 'offline');
  }
  // If no cache: BACKEND_URL stays null, status stays 'checking' — silent
}

// ── Step 2: Verify in background (async, never blocks pages) ──
async function _verifyBackendInBackground() {
  let url = null;

  if (isLocalhost()) {
    url = 'http://localhost:5000';
  } else {
    // Use cached URL if we have one — skip Firebase read entirely
    url = window.BACKEND_URL;
    if (!url) {
      // No cache — read Firebase to get the tunnel URL
      try {
        const snap = await db.ref('config/backendUrl').once('value');
        url = snap.val();
      } catch(e) { console.error('Firebase read error:', e); }
    }
  }

  if (!url) {
    _setCachedBackend(null);
    window.BACKEND_URL = null;
    setBackendStatus('offline');
    return;
  }

  const alive = await pingBackend(url);
  if (alive) {
    window.BACKEND_URL = url;
    _setCachedBackend(url);
    setBackendStatus('online');
  } else {
    // Ping failed — try re-reading Firebase in case tunnel URL changed
    if (!isLocalhost()) {
      try {
        const snap = await db.ref('config/backendUrl').once('value');
        const freshUrl = snap.val();
        if (freshUrl && freshUrl !== url) {
          const aliveRetry = await pingBackend(freshUrl);
          if (aliveRetry) {
            window.BACKEND_URL = freshUrl;
            _setCachedBackend(freshUrl);
            setBackendStatus('online');
            return;
          }
        }
      } catch(e) {}
    }
    window.BACKEND_URL = null;
    _setCachedBackend(null);
    setBackendStatus('offline');
  }
}

function setBackendStatus(status) {
  window.BACKEND_STATUS = status;
  const dot   = document.getElementById('backend-dot');
  const label = document.getElementById('backend-label');
  if (dot)   dot.className     = 'backend-dot bk-' + status;
  if (label) label.textContent = { checking: 'Checking…', online: 'Server Online', offline: 'Server Offline' }[status] || '';
}

function startStatusPoller() {
  setInterval(() => _verifyBackendInBackground(), 3 * 60 * 1000);
}

// ================================================================
// UTILITIES
// ================================================================

function formatCount(n) {
  n = parseInt(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(n);
}

function formatDuration(s) {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const d    = Date.now() - ts;
  const mins = Math.floor(d / 60000),    hrs  = Math.floor(d / 3600000),
        days = Math.floor(d / 86400000), wks  = Math.floor(d / 604800000),
        mos  = Math.floor(d / 2592000000), yrs = Math.floor(d / 31536000000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  if (hrs  < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  if (days < 7)  return `${days} day${days > 1 ? 's' : ''} ago`;
  if (wks  < 4)  return `${wks} week${wks > 1 ? 's' : ''} ago`;
  if (mos  < 12) return `${mos} month${mos > 1 ? 's' : ''} ago`;
  return `${yrs} year${yrs > 1 ? 's' : ''} ago`;
}

function extractVideoId(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Avatar helper ────────────────────────────────────────────────
// Sets any element to show a photo or an initial letter fallback
function setAvatarEl(el, photoUrl, fallbackName) {
  const initial = (fallbackName || 'U').charAt(0).toUpperCase();
  el.innerHTML  = '';
  if (photoUrl) {
    const img   = document.createElement('img');
    img.src     = photoUrl;
    img.alt     = '';
    img.onerror = () => { el.innerHTML = ''; el.textContent = initial; };
    el.appendChild(img);
  } else {
    el.textContent = initial;
  }
}


// ── Toast notifications ──────────────────────────────────────────
function showToast(msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const t       = document.createElement('div');
  t.className   = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Fetch log (add-video page) ───────────────────────────────────
function addLog(containerId, message, type = 'info') {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.style.display = 'block';
  const icons = { info: '<i class="fas fa-info-circle"></i>', success: '<i class="fas fa-check-circle"></i>', error: '<i class="fas fa-times-circle"></i>', warn: '<i class="fas fa-exclamation-triangle"></i>', loading: '<i class="fas fa-spinner fa-spin"></i>' };
  const line  = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.innerHTML = `<span>${icons[type] || '•'}</span><span>${message}</span>`;
  c.appendChild(line);
  c.scrollTop = c.scrollHeight;
}

function clearLog(containerId) {
  const c = document.getElementById(containerId);
  if (c) { c.innerHTML = ''; c.style.display = 'none'; }
}

// ── Auth helpers ─────────────────────────────────────────────────
async function requireAuth() {
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      if (!user) location.href = 'login.html?redirect=' + encodeURIComponent(location.href);
      else resolve(user);
    });
  });
}

// Updates the header avatar on every page.
// Priority: custom photoUrl stored in DB > Google Auth photo > initial letter
function updateHeaderAuth(user) {
  const btn = document.getElementById('sign-in-btn');
  const av  = document.getElementById('user-avatar');
  if (user) {
    if (btn) btn.style.display = 'none';
    if (av) {
      av.style.display = 'flex';
      // Step 1 — show Auth photo instantly (no DB wait)
      setAvatarEl(av, user.photoURL || null, user.displayName || user.email || 'U');
      // Step 2 — override with custom DB photo if user has set one
      db.ref(`users/${user.uid}/photoUrl`).once('value')
        .then(snap => {
          if (snap.exists() && snap.val()) {
            setAvatarEl(av, snap.val(), user.displayName || user.email || 'U');
          }
        })
        .catch(() => {});
    }
  } else {
    if (btn) btn.style.display = 'flex';
    if (av)  av.style.display  = 'none';
  }
}

// Auto-init on every page load
// Step 1: restore from cache instantly (synchronous — no delay)
restoreBackendFromCache();
// Step 2: verify in background (never blocks any page)
_verifyBackendInBackground();
startStatusPoller();
// Keep _backendReadyPromise as resolved promise so pages that await it still work
window._backendReadyPromise = Promise.resolve();
auth.onAuthStateChanged(updateHeaderAuth);

// ================================================================
// USERNAME SYSTEM
// ================================================================

async function checkUsernameExists(username) {
  username = username.toLowerCase().replace(/^@/,'');
  const snap = await db.ref('usernames/' + username).once('value');
  return snap.exists();
}

async function setUsername(uid, username) {
  username = username.toLowerCase().trim().replace(/^@/,'');
  if (username.length < 8) throw new Error('Username must be at least 8 characters (not counting @)');
  if (!/^[a-z0-9_]+$/.test(username)) throw new Error('Only letters, numbers, underscores allowed');
  const exists = await checkUsernameExists(username);
  if (exists) throw new Error('Username already taken');
  const full = '@' + username;
  // Remove old username index if user had one
  const old = await db.ref(`users/${uid}/username`).once('value');
  if (old.exists()) {
    const oldName = old.val().replace(/^@/,'');
    await db.ref('usernames/' + oldName).remove();
  }
  await db.ref(`users/${uid}/username`).set(full);
  await db.ref('usernames/' + username).set(uid);
  return full;
}

async function getUserByUsername(username) {
  username = username.toLowerCase().replace(/^@/,'');
  const snap = await db.ref('usernames/' + username).once('value');
  if (!snap.exists()) return null;
  const uid  = snap.val();
  const user = await getUserData(uid);
  return user ? { uid, ...user } : null;
}

async function searchUsers(query) {
  query = query.toLowerCase().replace(/^@/,'');
  if (!query || query.length < 2) return [];
  try {
    const snap = await db.ref('users').orderByChild('name').limitToFirst(200).once('value');
    if (!snap.exists()) return [];
    const results = [];
    snap.forEach(child => {
      const u     = child.val();
      const uname = (u.username || '').toLowerCase().replace(/^@/,'');
      const name  = (u.name || '').toLowerCase();
      if (uname.includes(query) || name.includes(query)) {
        results.push({ uid: child.key, ...u });
      }
    });
    return results.slice(0, 20);
  } catch(e) { return []; }
}

// ================================================================
// SUBSCRIBERS
// ================================================================

function formatSubs(n) {
  n = parseInt(n) || 0;
  if (n < 1000)    return String(n);
  if (n < 1000000) return (n/1000).toFixed(1).replace('.0','') + 'K';
  return (n/1000000).toFixed(1).replace('.0','') + 'M';
}

async function getSubCount(uid) {
  const snap = await db.ref(`subscribers/${uid}`).once('value');
  return snap.numChildren();
}

async function isSubscribed(viewerUid, channelUid) {
  const snap = await db.ref(`subscribers/${channelUid}/${viewerUid}`).once('value');
  return snap.exists();
}

async function toggleSubscribe(viewerUid, channelUid) {
  const subbed = await isSubscribed(viewerUid, channelUid);
  if (subbed) {
    await db.ref(`subscribers/${channelUid}/${viewerUid}`).remove();
    await db.ref(`subscriptions/${viewerUid}/${channelUid}`).remove();
    return false;
  } else {
    await db.ref(`subscribers/${channelUid}/${viewerUid}`).set(Date.now());
    await db.ref(`subscriptions/${viewerUid}/${channelUid}`).set(Date.now());
    return true;
  }
}

async function initSubBtn(btnEl, channelUid) {
  if (!btnEl) return;
  const viewer = auth.currentUser;
  if (!viewer || viewer.uid === channelUid) { btnEl.style.display='none'; return; }
  const subbed = await isSubscribed(viewer.uid, channelUid);
  _renderSubBtn(btnEl, subbed, channelUid);
}

function _renderSubBtn(btn, subbed, channelUid) {
  btn.className   = subbed ? 'sub-btn subbed' : 'sub-btn';
  btn.innerHTML = subbed ? '<i class="fas fa-check"></i> Subscribed' : 'Subscribe';
  btn.onclick = async () => {
    const viewer = auth.currentUser;
    if (!viewer) { location.href='login.html'; return; }
    btn.disabled = true;
    try {
      const nowSubbed = await toggleSubscribe(viewer.uid, channelUid);
      _renderSubBtn(btn, nowSubbed, channelUid);
      // refresh count
      const el = document.getElementById('sub-count-display');
      if (el) {
        const n = await getSubCount(channelUid);
        el.textContent = formatSubs(n);
        el.title = n >= 1000 ? n.toLocaleString() + ' subscribers' : '';
      }
      showToast(nowSubbed ? 'Subscribed!' : 'Unsubscribed', nowSubbed ? 'success' : 'info');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
    btn.disabled = false;
  };
}

// ================================================================
// VIDEO CARD — updated with clickable avatar
// ================================================================

function renderVideoCard(videoId, v, opts) {
  opts = opts || {};
  const thumb  = v.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const dur    = v.durationFormatted || formatDuration(v.duration);
  const name   = v.addedByName || v.channel || 'Unknown';
  const uid    = v.addedByUid || '';
  // If no uid but name is ASTUBE, resolve to official channel uid
  const _officialUid = window.ASTUBE_OFFICIAL_UID || '';
  const _resolvedUid = uid || (name === 'ASTUBE' && _officialUid ? _officialUid : '');
  const channelHref  = _resolvedUid ? `channel.html?uid=${_resolvedUid}` : '#';
  // Use cached live photo — falls back to saved addedByPhotoUrl, then initial
  const _cachedPhoto = _resolvedUid ? (_userPhotoCache[_resolvedUid] || '') : '';
  const photo  = _cachedPhoto || v.addedByPhotoUrl || '';
  const _ini = name.charAt(0).toUpperCase();
  const avHtml = photo && photo !== 'icon.png'
    ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none';this.parentNode.textContent='${_ini}'">` 
    : _ini;
  const editBtns = opts.showEdit
    ? `<div class="card-edit-btns">
        <button onclick="event.stopPropagation();editVideo('${videoId}')" class="card-edit-btn"><i class="fas fa-pen"></i> Edit</button>
        <button onclick="event.stopPropagation();deleteVideo('${videoId}')" class="card-edit-btn del"><i class="fas fa-trash"></i> Delete</button>
       </div>` : '';

  return `
  <div class="video-card" onclick="location.href='player.html?v=${videoId}'">
    <div class="card-thumb">
      <img src="${thumb}" alt="" loading="lazy"
        onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'"/>
      ${dur ? `<span class="dur-badge">${dur}</span>` : ''}
    </div>
    <div class="card-info">
      <div class="card-avatar" onclick="event.stopPropagation();location.href='${channelHref}'"
           style="cursor:pointer" title="View channel">${avHtml}</div>
      <div class="card-meta">
        <p class="card-title">${v.title || 'Untitled'}</p>
        <p class="card-ch" onclick="event.stopPropagation();location.href='${channelHref}'"
           style="cursor:pointer">${name}</p>
        <p class="card-stats">${formatCount(v.views)} views · ${timeAgo(v.addedAt)}</p>
      </div>
    </div>
    ${editBtns}
  </div>`;
}

// ================================================================
// USERNAME SETUP PROMPT (shown after first login)
// ================================================================

async function checkAndPromptUsername(user) {
  const snap = await db.ref(`users/${user.uid}/username`).once('value');
  if (!snap.exists()) {
    // Show username setup modal
    showUsernameModal(user.uid);
  }
}

function showUsernameModal(uid) {
  // Remove existing if any
  const ex = document.getElementById('username-modal');
  if (ex) ex.remove();

  const modal = document.createElement('div');
  modal.id = 'username-modal';
  modal.innerHTML = `
    <div class="umodal-overlay">
      <div class="umodal-box">
        <div class="umodal-icon">@</div>
        <h2>Set Your Username</h2>
        <p>Choose a unique username for your ASTUBE channel.<br>Min 8 chars, letters/numbers/underscore only.</p>
        <div class="umodal-input-wrap">
          <span class="umodal-at">@</span>
          <input id="umodal-input" type="text" placeholder="yourname123" maxlength="30" autocomplete="off"/>
        </div>
        <div id="umodal-err" class="umodal-err"></div>
        <button id="umodal-btn" onclick="submitUsername('${uid}')">Set Username</button>
        <p class="umodal-note">You can change this later in your profile.</p>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const inp = document.getElementById('umodal-input');
  inp.addEventListener('keydown', e => { if(e.key==='Enter') submitUsername(uid); });
  setTimeout(() => inp.focus(), 100);
}

async function submitUsername(uid) {
  const inp = document.getElementById('umodal-input');
  const err = document.getElementById('umodal-err');
  const btn = document.getElementById('umodal-btn');
  const val = (inp.value || '').trim();
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const username = await setUsername(uid, val);
    showToast('Username set: ' + username, 'success');
    const modal = document.getElementById('username-modal');
    if (modal) modal.remove();
  } catch(e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Set Username';
  }
}
