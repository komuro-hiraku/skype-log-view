/* ============================================================
   Skype Log Viewer – app.js
   Handles: file loading, parsing, rendering, search, bookmarks
   ============================================================ */

// ── State ────────────────────────────────────────────────────
const state = {
  data:          null,   // raw parsed JSON
  myUserId:      null,   // account owner's Skype ID
  conversations: [],     // processed + sorted conversations
  currentConvId: null,   // selected conversation ID
  bookmarks:     {},     // { convId: [msgId, …] }
  search: {
    query:        '',
    matches:      [],    // <mark> elements
    currentIndex: -1,
  },
};

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadBookmarksFromStorage();
  bindEvents();
});

// ── Event bindings ────────────────────────────────────────────
function bindEvents() {
  // File inputs
  byId('file-input').addEventListener('change', onFileInputChange);
  byId('file-input-reload').addEventListener('change', onFileInputChange);
  byId('btn-load').addEventListener('click', () => byId('file-input-reload').click());

  // Drag & drop anywhere on the page
  document.addEventListener('dragover',  onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop',      onDrop);

  // Sidebar tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // Conversation filter
  byId('conv-search').addEventListener('input', debounce(filterConversations, 200));

  // Message search
  const si = byId('search-input');
  si.addEventListener('input',   debounce(onSearch, 280));
  si.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.shiftKey ? searchPrev() : searchNext(); }
    if (e.key === 'Escape') { clearSearch(); }
  });
  byId('btn-search-prev').addEventListener('click', searchPrev);
  byId('btn-search-next').addEventListener('click', searchNext);
  byId('btn-search-clear').addEventListener('click', clearSearch);
}

// ── File handling ─────────────────────────────────────────────
function onFileInputChange(e) {
  const file = e.target.files[0];
  if (file) loadFile(file);
  e.target.value = '';
}

function onDragOver(e) {
  e.preventDefault();
  byId('drop-overlay').classList.remove('hidden');
}

function onDragLeave(e) {
  if (!e.relatedTarget) byId('drop-overlay').classList.add('hidden');
}

function onDrop(e) {
  e.preventDefault();
  byId('drop-overlay').classList.add('hidden');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    showError('JSONファイルをドロップしてください');
    return;
  }
  loadFile(file);
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      processData(JSON.parse(e.target.result));
    } catch (err) {
      showError('ファイルの解析に失敗しました: ' + err.message);
    }
  };
  reader.onerror = () => showError('ファイルの読み込みに失敗しました');
  reader.readAsText(file, 'utf-8');
}

// ── Data processing ───────────────────────────────────────────
function processData(json) {
  if (!json.conversations || !Array.isArray(json.conversations)) {
    showError('有効な Skype エクスポートファイルではありません（conversations が見つかりません）');
    return;
  }

  state.data      = json;
  state.myUserId  = json.userId || '';

  state.conversations = json.conversations
    .filter(c => c.MessageList && c.MessageList.length > 0)
    .map(c => ({
      ...c,
      _lastTime:   lastMessageTime(c.MessageList),
      MessageList: [...c.MessageList].sort(
        (a, b) => +new Date(a.originalarrivaltime) - +new Date(b.originalarrivaltime)
      ),
    }))
    .sort((a, b) => b._lastTime - a._lastTime);

  showViewer();
  renderConversationList(state.conversations);
  renderBookmarkList();

  if (state.conversations.length > 0) {
    selectConversation(state.conversations[0].id);
  }
}

function lastMessageTime(list) {
  return Math.max(...list.map(m => +new Date(m.originalarrivaltime)));
}

// ── View switching ────────────────────────────────────────────
function showViewer() {
  byId('welcome').classList.add('hidden');
  byId('viewer').classList.remove('hidden');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  ['conversations', 'bookmarks'].forEach(id => {
    byId(`tab-${id}`).classList.toggle('hidden', id !== name);
  });
  if (name === 'bookmarks') renderBookmarkList();
}

// ── Conversation list ─────────────────────────────────────────
function renderConversationList(list) {
  const container = byId('conversation-list');
  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  list.forEach(conv => {
    const last    = lastNonEmptyMessage(conv.MessageList);
    const preview = textPreview(last?.content, 52);
    const bCount  = bookmarkCount(conv.id);

    const el = document.createElement('div');
    el.className = 'conv-item';
    el.dataset.convId = conv.id;
    if (conv.id === state.currentConvId) el.classList.add('active');

    el.innerHTML =
      `<div class="conv-name">${esc(conv.displayName || conv.id)}</div>` +
      `<div class="conv-preview">${esc(preview)}</div>` +
      `<div class="conv-meta">` +
        `<span class="conv-time">${relTime(last?.originalarrivaltime)}</span>` +
        (bCount ? `<span class="conv-badge">🔖 ${bCount}</span>` : '') +
      `</div>`;

    el.addEventListener('click', () => selectConversation(conv.id));
    frag.appendChild(el);
  });

  container.appendChild(frag);
}

function filterConversations() {
  const q = byId('conv-search').value.trim().toLowerCase();
  const filtered = q
    ? state.conversations.filter(c =>
        (c.displayName || c.id).toLowerCase().includes(q))
    : state.conversations;
  renderConversationList(filtered);
}

function lastNonEmptyMessage(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].content) return list[i];
  }
  return list[list.length - 1];
}

// ── Select conversation ───────────────────────────────────────
function selectConversation(convId) {
  state.currentConvId = convId;

  document.querySelectorAll('.conv-item').forEach(el =>
    el.classList.toggle('active', el.dataset.convId === convId));

  const conv = state.conversations.find(c => c.id === convId);
  if (!conv) return;

  byId('conversation-title').textContent = conv.displayName || conv.id;

  clearSearch(/* silent */ true);
  renderMessages(conv);

  // Scroll to bottom
  requestAnimationFrame(() => {
    const mc = byId('message-container');
    mc.scrollTop = mc.scrollHeight;
  });
}

// ── Message rendering ─────────────────────────────────────────
function renderMessages(conv) {
  const container = byId('messages');
  container.innerHTML = '';

  const frag = document.createDocumentFragment();
  let prevDateStr = null;
  let prevSender  = null;
  let prevTime    = null;

  conv.MessageList.forEach(msg => {
    const t       = new Date(msg.originalarrivaltime);
    const dateStr = toDateStr(t);

    if (dateStr !== prevDateStr) {
      frag.appendChild(makeDateSep(dateStr));
      prevDateStr = dateStr;
      prevSender  = null;
      prevTime    = null;
    }

    const isGrouped = prevSender === msg.from &&
                      prevTime   !== null &&
                      (t - prevTime) < 5 * 60 * 1000;
    const isSelf    = msg.from === state.myUserId;
    const isSystem  = isSystemMsg(msg.messagetype);

    frag.appendChild(makeMsgEl(msg, isSelf, isGrouped, isSystem));

    prevSender = msg.from;
    prevTime   = t;
  });

  container.appendChild(frag);
}

function isSystemMsg(type) {
  return type && (type.startsWith('Event/') || type.startsWith('ThreadActivity/'));
}

function makeDateSep(label) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.textContent = label;
  return el;
}

function makeMsgEl(msg, isSelf, isGrouped, isSystem) {
  const wrapper = document.createElement('div');

  if (isSystem) {
    wrapper.className = 'msg-wrapper system-msg-wrapper';
  } else {
    wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'}${isGrouped ? ' grouped' : ''}`;
  }

  wrapper.dataset.msgId  = msg.id;
  wrapper.dataset.convId = msg.conversationid || state.currentConvId;

  const bookmarked   = isBookmarked(wrapper.dataset.convId, msg.id);
  const senderName   = msg.displayName || extractUsername(msg.from);
  const timeStr      = toTimeStr(new Date(msg.originalarrivaltime));
  const contentHTML  = renderContent(msg);

  const senderLine = (!isGrouped && !isSelf && !isSystem)
    ? `<div class="msg-sender">${esc(senderName)}</div>`
    : '';

  wrapper.innerHTML =
    `<div class="msg-bubble">` +
      senderLine +
      `<div class="msg-content">${contentHTML}</div>` +
      `<div class="msg-footer">` +
        `<span class="msg-time">${timeStr}</span>` +
        `<button class="bookmark-btn${bookmarked ? ' bookmarked' : ''}" title="ブックマーク">` +
          (bookmarked ? '🔖' : '🏷️') +
        `</button>` +
      `</div>` +
    `</div>`;

  wrapper.querySelector('.bookmark-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleBookmark(wrapper.dataset.convId, msg.id, wrapper);
  });

  return wrapper;
}

// ── Content rendering ─────────────────────────────────────────
function renderContent(msg) {
  const type    = msg.messagetype || 'RichText';
  const content = msg.content     || '';

  if (type === 'RichText' || type === 'RichText/Html') {
    return sanitizeHTML(content);
  }
  if (type.startsWith('RichText/')) {
    return renderRichVariant(type, content);
  }
  if (type.startsWith('Event/')) {
    return `<span class="system-msg">${renderEvent(type, content)}</span>`;
  }
  if (type.startsWith('ThreadActivity/')) {
    return `<span class="system-msg">${renderThreadActivity(type, content)}</span>`;
  }
  if (type === 'Poll') {
    return `<span class="system-msg">📊 Poll</span>`;
  }
  const fallback = stripTags(content).slice(0, 200);
  return `<span class="msg-type-tag">[${esc(type)}]</span>${fallback ? ' ' + esc(fallback) : ''}`;
}

function renderRichVariant(type, content) {
  const sub = type.split('/')[1] || '';
  if (sub === 'UriObject') {
    const title = xmlText(content, 'Title') || xmlText(content, 'OriginalName') || 'ファイル';
    return `<span class="attachment">📎 ${esc(title)}</span>`;
  }
  if (sub === 'Media_GenericFile') {
    const title = xmlAttr(content, 'OriginalName', 'v') || 'ファイル';
    return `<span class="attachment">📎 ${esc(title)}</span>`;
  }
  if (sub === 'Media_CallRecording') {
    return `<span class="attachment">🎥 通話録音</span>`;
  }
  if (sub === 'Media_AudioMsg') {
    return `<span class="attachment">🎵 音声メッセージ</span>`;
  }
  if (sub === 'Media_Video') {
    return `<span class="attachment">🎬 動画</span>`;
  }
  const text = stripTags(content).slice(0, 100);
  return `<span class="attachment">📎 ${esc(text || sub)}</span>`;
}

function renderEvent(type, content) {
  const sub = type.split('/')[1] || '';
  if (sub === 'Call') {
    const callType = xmlAttr(content, 'partlist', 'type') || '';
    if (callType === 'started') return '📞 通話開始';
    if (callType === 'ended') {
      const secs = parseInt(xmlText(content, 'duration') || '0', 10);
      return `📞 通話終了 (${fmtDuration(secs)})`;
    }
    return '📞 通話';
  }
  return esc(`[${type}]`);
}

function renderThreadActivity(type, content) {
  const sub = type.split('/')[1] || '';
  switch (sub) {
    case 'AddMember': {
      const name = stripTags(xmlText(content, 'target') || '');
      return `👤 メンバーが追加されました${name ? ': ' + esc(name) : ''}`;
    }
    case 'DeleteMember': {
      const name = stripTags(xmlText(content, 'target') || '');
      return `👤 メンバーが退出しました${name ? ': ' + esc(name) : ''}`;
    }
    case 'TopicUpdate': {
      const topic = stripTags(xmlText(content, 'value') || '');
      return `✏️ トピック変更: ${esc(topic)}`;
    }
    case 'PictureUpdate':
      return '🖼️ グループ画像が変更されました';
    case 'HistoryDisclosedUpdate':
      return '📜 履歴設定が変更されました';
    case 'JoiningEnabledUpdate':
      return '🔗 参加リンク設定が変更されました';
    default:
      return esc(`[${type}]`);
  }
}

// ── HTML Sanitizer ────────────────────────────────────────────
const SAFE_TAGS = new Set([
  'p','br','b','i','u','s','em','strong','span','div',
  'a','ul','ol','li','pre','code','blockquote',
  'h1','h2','h3','h4',
]);

function sanitizeHTML(raw) {
  if (!raw) return '';

  // Pre-process Skype custom elements
  let html = raw
    .replace(/<ss[^>]*>([\s\S]*?)<\/ss>/gi, '$1')
    .replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi,
      (_, name) => `<span class="mention">@${name}</span>`)
    .replace(/<legacyquote>[\s\S]*?<\/legacyquote>/gi, '')
    .replace(/<quote\b[^>]*>([\s\S]*?)<\/quote>/gi,
      (_, inner) => `<blockquote>${inner}</blockquote>`);

  const doc  = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const temp = document.createElement('div');
  temp.appendChild(walkSanitize(doc.body));
  return temp.innerHTML;
}

function walkSanitize(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tag = node.tagName.toLowerCase();

  if (!SAFE_TAGS.has(tag)) {
    // Replace with children
    const frag = document.createDocumentFragment();
    node.childNodes.forEach(child => {
      const s = walkSanitize(child);
      if (s) frag.appendChild(s);
    });
    return frag;
  }

  const el = document.createElement(tag);

  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    if (/^https?:|^mailto:/i.test(href)) {
      el.href   = href;
      el.target = '_blank';
      el.rel    = 'noopener noreferrer';
    }
  }
  if (node.classList.contains('mention')) el.className = 'mention';

  node.childNodes.forEach(child => {
    const s = walkSanitize(child);
    if (s) el.appendChild(s);
  });
  return el;
}

// ── Search ────────────────────────────────────────────────────
function onSearch() {
  const q = byId('search-input').value;
  state.search.query = q.trim();
  if (!state.search.query) {
    clearSearchHighlights();
    updateSearchUI();
    return;
  }
  performSearch(state.search.query);
}

function performSearch(query) {
  clearSearchHighlights();

  const root  = byId('messages');
  const regex = new RegExp(reEscape(query), 'gi');
  const marks = [];

  // Walk all text nodes under #messages
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      // Skip times, senders, system labels
      const p = n.parentElement;
      if (p && (p.classList.contains('msg-time') ||
                p.classList.contains('msg-sender') ||
                p.classList.contains('msg-type-tag') ||
                p.classList.contains('system-msg') ||
                p.classList.contains('bookmark-btn'))) {
        return NodeFilter.FILTER_REJECT;
      }
      return regex.test(n.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  textNodes.forEach(tn => {
    regex.lastIndex = 0;
    const text  = tn.textContent;
    const parts = text.split(regex);
    const found = text.match(regex) || [];
    if (!found.length) return;

    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      frag.appendChild(document.createTextNode(part));
      if (i < found.length) {
        const mark = document.createElement('mark');
        mark.className  = 'search-highlight';
        mark.textContent = found[i];
        marks.push(mark);
        frag.appendChild(mark);
      }
    });
    tn.parentNode.replaceChild(frag, tn);
  });

  state.search.matches      = marks;
  state.search.currentIndex = marks.length > 0 ? 0 : -1;
  if (marks.length > 0) activateMatch(0);
  updateSearchUI();
}

function clearSearchHighlights() {
  document.querySelectorAll('mark.search-highlight').forEach(m => {
    const parent = m.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
  });
  state.search.matches      = [];
  state.search.currentIndex = -1;
}

function activateMatch(idx) {
  const marks = state.search.matches;
  marks.forEach((m, i) => m.classList.toggle('current', i === idx));
  const cur = marks[idx];
  if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
  state.search.currentIndex = idx;
  updateSearchUI();
}

function searchNext() {
  const { matches, currentIndex } = state.search;
  if (!matches.length) return;
  activateMatch((currentIndex + 1) % matches.length);
}

function searchPrev() {
  const { matches, currentIndex } = state.search;
  if (!matches.length) return;
  activateMatch((currentIndex - 1 + matches.length) % matches.length);
}

function clearSearch(silent = false) {
  if (!silent) byId('search-input').value = '';
  state.search.query = '';
  clearSearchHighlights();
  if (!silent) updateSearchUI();
}

function updateSearchUI() {
  const { matches, currentIndex, query } = state.search;
  const el = byId('search-count');
  if (!query)          el.textContent = '';
  else if (!matches.length) el.textContent = '見つかりません';
  else                 el.textContent = `${currentIndex + 1} / ${matches.length}`;
}

// ── Bookmarks ─────────────────────────────────────────────────
const BM_STORAGE_KEY = 'skype-viewer-bookmarks-v1';

function loadBookmarksFromStorage() {
  try {
    const raw = localStorage.getItem(BM_STORAGE_KEY);
    if (raw) state.bookmarks = JSON.parse(raw);
  } catch { state.bookmarks = {}; }
}

function saveBookmarks() {
  localStorage.setItem(BM_STORAGE_KEY, JSON.stringify(state.bookmarks));
}

function isBookmarked(convId, msgId) {
  return !!(state.bookmarks[convId]?.includes(msgId));
}

function bookmarkCount(convId) {
  return state.bookmarks[convId]?.length || 0;
}

function toggleBookmark(convId, msgId, wrapperEl) {
  if (!state.bookmarks[convId]) state.bookmarks[convId] = [];
  const arr = state.bookmarks[convId];
  const idx = arr.indexOf(msgId);

  if (idx === -1) {
    arr.push(msgId);
  } else {
    arr.splice(idx, 1);
    if (!arr.length) delete state.bookmarks[convId];
  }
  saveBookmarks();

  const bm  = isBookmarked(convId, msgId);
  const btn = wrapperEl.querySelector('.bookmark-btn');
  btn.classList.toggle('bookmarked', bm);
  btn.textContent = bm ? '🔖' : '🏷️';

  // Refresh sidebar counts
  filterConversations();
  // Re-apply active class
  const active = document.querySelector(`.conv-item[data-conv-id="${CSS.escape(state.currentConvId)}"]`);
  if (active) active.classList.add('active');
}

function renderBookmarkList() {
  const container = byId('bookmark-list');
  container.innerHTML = '';

  const items = [];
  Object.entries(state.bookmarks).forEach(([convId, msgIds]) => {
    const conv = state.conversations.find(c => c.id === convId);
    if (!conv) return;
    msgIds.forEach(msgId => {
      const msg = conv.MessageList.find(m => m.id === msgId);
      if (msg) items.push({ conv, msg });
    });
  });

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">ブックマークはありません<br><small>メッセージ右下の 🏷️ をクリックして追加</small></div>';
    return;
  }

  items.sort((a, b) => +new Date(a.msg.originalarrivaltime) - +new Date(b.msg.originalarrivaltime));

  const frag = document.createDocumentFragment();
  items.forEach(({ conv, msg }) => {
    const el      = document.createElement('div');
    el.className  = 'bookmark-item';
    const preview = stripTags(msg.content || '').slice(0, 60);
    const timeStr = toDateTimeStr(new Date(msg.originalarrivaltime));

    el.innerHTML =
      `<div class="bookmark-conv-name">${esc(conv.displayName || conv.id)}</div>` +
      `<div class="bookmark-sender">${esc(msg.displayName || extractUsername(msg.from))}</div>` +
      `<div class="bookmark-preview">${esc(preview)}${preview.length >= 60 ? '…' : ''}</div>` +
      `<div class="bookmark-time">${timeStr}</div>`;

    el.addEventListener('click', () => jumpToBookmark(conv.id, msg.id));
    frag.appendChild(el);
  });
  container.appendChild(frag);
}

function jumpToBookmark(convId, msgId) {
  if (state.currentConvId !== convId) {
    selectConversation(convId);
    // Wait for render
    setTimeout(() => scrollToMsg(msgId), 60);
  } else {
    scrollToMsg(msgId);
  }
  switchTab('conversations');
}

function scrollToMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1400);
}

// ── Helpers ───────────────────────────────────────────────────
function byId(id) { return document.getElementById(id); }

function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function reEscape(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractUsername(from) {
  if (!from) return 'Unknown';
  return from.replace(/^8:live:|^8:|^28:/, '');
}

function textPreview(html, maxLen) {
  const t = stripTags(html || '');
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

function toDateStr(date) {
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
}

function toTimeStr(date) {
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function toDateTimeStr(date) {
  return date.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function relTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - +new Date(isoStr);
  const d    = Math.floor(diff / 86400000);
  if (d === 0) return toTimeStr(new Date(isoStr));
  if (d === 1) return '昨日';
  if (d <   7) return `${d}日前`;
  if (d <  30) return `${Math.floor(d / 7)}週間前`;
  if (d < 365) return `${Math.floor(d / 30)}ヶ月前`;
  return `${Math.floor(d / 365)}年前`;
}

function fmtDuration(s) {
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60 ? (s % 60) + '秒' : ''}`;
  const h = Math.floor(m / 60);
  return `${h}時間${m % 60 ? (m % 60) + '分' : ''}`;
}

/** Extract text content of a named XML element */
function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : null;
}

/** Extract attribute value from a named XML element */
function xmlAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\b${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function showError(msg) {
  // Minimal error notification
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#ff4444', color: '#fff', padding: '10px 20px',
    borderRadius: '8px', zIndex: 9999, fontWeight: '600',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  });
  banner.textContent = msg;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 5000);
}
