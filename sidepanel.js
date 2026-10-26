// Kōshi (格子) — side panel tab list.
//   Click            → switch to tab
//   Middle-click     → close tab
//   Double-click     → pin / unpin
//   Right-click      → context menu (pin / unpin, mute, duplicate, close)
//   Right-click empty space → "Panel color…" (per-space background)
//   Speaker icon     → shown while a tab plays audio; click to mute / unmute
//   Ctrl+B           → toggle this panel (see manifest "commands")
//   Drag             → reorder (drop into the grid to pin, into the list to unpin)

const pinnedEl = document.getElementById('pinned');
const tabsEl = document.getElementById('tabs');
let windowId = null;
let dragTabId = null;

function faviconFor(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', tab.url || tab.pendingUrl || '');
  u.searchParams.set('size', '32');
  return u.toString();
}

function img(tab) {
  const i = document.createElement('img');
  i.src = faviconFor(tab);
  i.onerror = () => { i.style.visibility = 'hidden'; };
  return i;
}

const SPEAKER_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const MUTED_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 6l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

// Speaker icon for tabs that are playing audio (or muted). Click toggles mute.
function audioIcon(tab) {
  const muted = tab.mutedInfo && tab.mutedInfo.muted;
  if (!tab.audible && !muted) return null;
  const b = document.createElement('button');
  b.className = 'audio' + (muted ? ' muted' : '');
  b.innerHTML = muted ? MUTED_SVG : SPEAKER_SVG;
  b.title = muted ? 'Unmute tab' : 'Mute tab';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.update(tab.id, { muted: !muted });
  });
  return b;
}

// ---- Right-click context menu ----
const menuEl = document.createElement('div');
menuEl.className = 'menu';
menuEl.hidden = true;
document.body.appendChild(menuEl);

function hideMenu() { menuEl.hidden = true; }

function showMenu(e, tab) {
  e.preventDefault();
  const muted = tab.mutedInfo && tab.mutedInfo.muted;
  const items = [
    [tab.pinned ? 'Unpin tab' : 'Pin tab', () => chrome.tabs.update(tab.id, { pinned: !tab.pinned })],
    [muted ? 'Unmute tab' : 'Mute tab', () => chrome.tabs.update(tab.id, { muted: !muted })],
    ['Reload', () => chrome.tabs.reload(tab.id)],
    ['Duplicate', () => chrome.tabs.duplicate(tab.id)],
    null,
    ['Close tab', () => chrome.tabs.remove(tab.id)],
  ];
  showItems(e, items);
}

function showItems(e, items) {
  menuEl.replaceChildren(...items.map((item) => {
    if (!item) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      return sep;
    }
    const b = document.createElement('button');
    b.textContent = item[0];
    b.addEventListener('click', () => { hideMenu(); item[1](); });
    return b;
  }));
  menuEl.hidden = false;
  // Keep the menu inside the panel.
  const { innerWidth: w, innerHeight: h } = window;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(e.clientX, w - r.width - 4) + 'px';
  menuEl.style.top = Math.min(e.clientY, h - r.height - 4) + 'px';
}

document.addEventListener('mousedown', (e) => { if (!menuEl.contains(e.target)) hideMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
window.addEventListener('blur', hideMenu);
document.addEventListener('scroll', hideMenu, true);
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Right-click on empty panel space → panel options.
  if (!e.target.closest('.tab, .pin, .menu')) {
    showItems(e, [['Panel color…', () => chrome.runtime.openOptionsPage()]]);
  }
});

// Per-space background color (set in the options page; storage is per profile).
function applyBg(color) {
  if (color) document.documentElement.style.setProperty('--bg', color);
  else document.documentElement.style.removeProperty('--bg');
}
chrome.storage.local.get('bgColor').then(({ bgColor }) => applyBg(bgColor));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bgColor) applyBg(changes.bgColor.newValue);
});

function wireCommon(el, tab) {
  el.title = tab.title || tab.url || '';
  el.addEventListener('click', () => chrome.tabs.update(tab.id, { active: true }));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) chrome.tabs.remove(tab.id); });
  el.addEventListener('dblclick', () => chrome.tabs.update(tab.id, { pinned: !tab.pinned }));
  el.addEventListener('contextmenu', (e) => showMenu(e, tab));

  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    dragTabId = tab.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    dragTabId = null;
    el.classList.remove('dragging');
    clearDropMarks();
  });
  el.addEventListener('dragover', (e) => {
    if (dragTabId === null || dragTabId === tab.id) return;
    e.preventDefault();
    clearDropMarks();
    el.classList.add('drop-before');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (dragTabId === null || dragTabId === tab.id) return;
    const id = dragTabId;
    // Match the pinned state of the target section, then move before the target.
    await chrome.tabs.update(id, { pinned: tab.pinned });
    const target = await chrome.tabs.get(tab.id);
    const moving = await chrome.tabs.get(id);
    const index = moving.index < target.index ? target.index - 1 : target.index;
    await chrome.tabs.move(id, { index });
  });
}

function clearDropMarks() {
  document.querySelectorAll('.drop-before').forEach((n) => n.classList.remove('drop-before'));
}

// Dropping on empty space in a section → append to that section.
function wireSection(sectionEl, pinned) {
  sectionEl.addEventListener('dragover', (e) => {
    if (dragTabId !== null && e.target === sectionEl) e.preventDefault();
  });
  sectionEl.addEventListener('drop', async (e) => {
    if (dragTabId === null || e.target !== sectionEl) return;
    e.preventDefault();
    const id = dragTabId;
    await chrome.tabs.update(id, { pinned });
    if (!pinned) await chrome.tabs.move(id, { index: -1 });
  });
}

async function render() {
  const tabs = await chrome.tabs.query({ windowId });
  const pinFrag = document.createDocumentFragment();
  const tabFrag = document.createDocumentFragment();

  for (const tab of tabs) {
    if (tab.pinned) {
      const el = document.createElement('div');
      el.className = 'pin' + (tab.active ? ' active' : '');
      el.appendChild(img(tab));
      const audio = audioIcon(tab);
      if (audio) el.appendChild(audio);
      wireCommon(el, tab);
      pinFrag.appendChild(el);
    } else {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.active ? ' active' : '');
      el.appendChild(img(tab));

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tab.title || tab.url || 'New Tab';
      el.appendChild(title);

      const audio = audioIcon(tab);
      if (audio) el.appendChild(audio);

      const close = document.createElement('button');
      close.className = 'close';
      close.textContent = '✕';
      close.title = 'Close tab';
      close.addEventListener('click', (e) => { e.stopPropagation(); chrome.tabs.remove(tab.id); });
      el.appendChild(close);

      wireCommon(el, tab);
      tabFrag.appendChild(el);
    }
  }

  pinnedEl.replaceChildren(pinFrag);
  tabsEl.replaceChildren(tabFrag);
}

let pending = null;
function scheduleRender() {
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = null; render(); });
}

document.getElementById('new-tab').addEventListener('click', () => {
  chrome.tabs.create({ windowId });
});

(async () => {
  windowId = (await chrome.windows.getCurrent()).id;

  // Let the background know this window's panel is open (for Ctrl+B toggling).
  // Chrome stops idle service workers (~30s), which drops the port and wipes
  // the background's state — so ping to keep it alive, and reconnect if it
  // gets stopped anyway.
  let port = null;
  const connect = () => {
    port = chrome.runtime.connect({ name: 'sidepanel' });
    port.postMessage({ windowId });
    port.onMessage.addListener((msg) => { if (msg.close) window.close(); });
    port.onDisconnect.addListener(() => setTimeout(connect, 100));
  };
  connect();
  setInterval(() => { try { port.postMessage({ ping: true }); } catch {} }, 20000);

  wireSection(pinnedEl, true);
  wireSection(tabsEl, false);

  for (const evt of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved',
                     'onActivated', 'onAttached', 'onDetached', 'onReplaced']) {
    chrome.tabs[evt].addListener(scheduleRender);
  }
  render();
})();
