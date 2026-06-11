// background.js — Service Worker
// Manages clipboard history, context-menu search engines, and message routing.

const SEARCH_KEY    = 'customSearches';
const CLIPBOARD_KEY = 'clipboardHistory';
const SETTINGS_KEY  = 'rcSettings';
const MAX_HISTORY   = 200;

/* ── Clipboard History ─────────────────────────────────────────────── */

function addClipboardItem(item) {
  chrome.storage.local.get([CLIPBOARD_KEY, SETTINGS_KEY], data => {
    const history    = data[CLIPBOARD_KEY] || [];
    const settings   = data[SETTINGS_KEY]  || {};
    const maxHistory = settings.maxHistory || MAX_HISTORY;

    // Deduplicate: skip if the same text was added within the last 3 s
    if (history.length > 0 &&
        history[0].text === item.text &&
        (Date.now() - history[0].timestamp) < 3000) {
      return;
    }

    const entry = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      text:      item.text,
      url:       item.url       || '',
      title:     item.title     || '',
      format:    item.format    || 'plain',
      timestamp: Date.now(),
      pinned:    false,
      source:    item.source    || 'page',
      type:      item.type      || 'text'
    };

    history.unshift(entry);

    // Keep pinned items; trim the rest to MAX_HISTORY
    const pinned    = history.filter(h => h.pinned);
    const unpinned  = history.filter(h => !h.pinned);
    const trimmed   = [...pinned, ...unpinned.slice(0, maxHistory - pinned.length)];

    chrome.storage.local.set({ [CLIPBOARD_KEY]: trimmed });
  });
}

/* ── Context Menu ──────────────────────────────────────────────────── */

function rebuildContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.storage.local.get([SEARCH_KEY], data => {
      const searches = data[SEARCH_KEY] || [];

      // ── Top-level parent ──
      chrome.contextMenus.create({
        id: 'rc-root',
        title: 'Rich Clip',
        contexts: ['page', 'selection', 'link', 'frame']
      });

      // ── Copy Page URL as… ──
      chrome.contextMenus.create({
        id: 'rc-page', parentId: 'rc-root',
        title: 'Copy Page URL as…',
        contexts: ['page', 'frame']
      });
      ['Markdown', 'HTML', 'BBCode', 'Rich Text', 'Plain Text', 'Citation'].forEach((name, i) => {
        chrome.contextMenus.create({
          id: `rc-page-${i}`, parentId: 'rc-page',
          title: name, contexts: ['page', 'frame']
        });
      });
      chrome.contextMenus.create({
        id: 'rc-page-stage', parentId: 'rc-page',
        title: 'Stage Page URL', contexts: ['page', 'frame']
      });

      chrome.contextMenus.create({ id: 'rc-sep1', parentId: 'rc-root', type: 'separator' });

      // ── Copy Selection as… ──
      chrome.contextMenus.create({
        id: 'rc-sel', parentId: 'rc-root',
        title: 'Copy Selection as…',
        contexts: ['selection']
      });
      ['Markdown', 'HTML', 'BBCode', 'Rich Text', 'Plain Text', 'Citation'].forEach((name, i) => {
        chrome.contextMenus.create({
          id: `rc-sel-${i}`, parentId: 'rc-sel',
          title: name, contexts: ['selection']
        });
      });
      chrome.contextMenus.create({
        id: 'rc-sel-stage', parentId: 'rc-sel',
        title: 'Stage Selection', contexts: ['selection']
      });

      chrome.contextMenus.create({ id: 'rc-sep2', parentId: 'rc-root', type: 'separator' });

      // ── Copy Link as… ──
      chrome.contextMenus.create({
        id: 'rc-link', parentId: 'rc-root',
        title: 'Copy Link as…',
        contexts: ['link']
      });
      ['Markdown', 'HTML', 'BBCode', 'Rich Text', 'Plain Text'].forEach((name, i) => {
        chrome.contextMenus.create({
          id: `rc-link-${i}`, parentId: 'rc-link',
          title: name, contexts: ['link']
        });
      });
      chrome.contextMenus.create({
        id: 'rc-link-stage', parentId: 'rc-link',
        title: 'Stage Link', contexts: ['link']
      });

      chrome.contextMenus.create({ id: 'rc-sep3', parentId: 'rc-root', type: 'separator' });

      // ── Tools ──
      chrome.contextMenus.create({
        id: 'rc-grab', parentId: 'rc-root',
        title: 'Grab Page Links', contexts: ['page', 'selection', 'link', 'frame']
      });
      chrome.contextMenus.create({
        id: 'rc-scrape', parentId: 'rc-root',
        title: 'Scrape Page Content', contexts: ['page', 'selection', 'link', 'frame']
      });

      chrome.contextMenus.create({ id: 'rc-sep4', parentId: 'rc-root', type: 'separator' });

      // ── Custom search engines ──
      if (searches.length > 0) {
        chrome.contextMenus.create({
          id: 'rc-searches', parentId: 'rc-root',
          title: 'Search with…', contexts: ['selection']
        });
        searches.forEach((engine, index) => {
          chrome.contextMenus.create({
            id: `rc-search-${index}`, parentId: 'rc-searches',
            title: engine.name, contexts: ['selection']
          });
        });

        chrome.contextMenus.create({ id: 'rc-sep5', parentId: 'rc-root', type: 'separator' });
      }

      // ── Open Dashboard ──
      chrome.contextMenus.create({
        id: 'rc-open', parentId: 'rc-root',
        title: 'Open Rich Clip Dashboard',
        contexts: ['page', 'selection', 'link', 'frame']
      });
    });
  });
}

/* ── Context Menu Click Handler ────────────────────────────────────── */

const FORMAT_KEYS  = ['markdown', 'html', 'bbcode', 'richtext', 'plain', 'citation'];
const FORMAT_NAMES = ['Markdown', 'HTML', 'BBCode', 'Rich Text', 'Plain Text', 'Citation'];

function buildFormatted(url, label, fmt, pageTitle, pageUrl) {
  const date = new Date().toLocaleDateString();
  label = label || pageTitle || url || pageUrl || '';
  url   = url   || pageUrl  || '';

  switch (fmt) {
    case 'markdown': return `[${label}](${url})`;
    case 'html':     return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    case 'bbcode':   return `[url=${url}]${label}[/url]`;
    case 'richtext': return label;
    case 'citation': {
      let host = '';
      try { host = new URL(url).hostname.replace('www.', ''); } catch (_) {}
      return `${label}. ${host}. ${date}. ${url}`;
    }
    default: return url;
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = typeof info.menuItemId === 'string' ? info.menuItemId : '';
  if (!id.startsWith('rc-')) return;

  const pageUrl   = info.pageUrl  || '';
  const linkUrl   = info.linkUrl  || '';
  const selection = info.selectionText || '';

  // ── Copy Page URL ──
  if (id.startsWith('rc-page-') && id !== 'rc-page-stage') {
    const idx = parseInt(id.split('-')[2], 10);
    const fmt = FORMAT_KEYS[idx] || 'plain';
    const output = buildFormatted(pageUrl, tab?.title || pageUrl, fmt, tab?.title, pageUrl);

    addClipboardItem({
      text: output, url: pageUrl, title: tab?.title || '',
      format: fmt, source: 'context-menu', type: 'link'
    });
    writeClipboardViaTab(tab, output);
    return;
  }

  if (id === 'rc-page-stage') {
    const output = `[${tab?.title || pageUrl}](${pageUrl})`;
    addClipboardItem({
      text: output, url: pageUrl, title: tab?.title || '',
      format: 'markdown', source: 'context-menu-stage', type: 'link'
    });
    return;
  }

  // ── Copy Selection ──
  if (id.startsWith('rc-sel-') && id !== 'rc-sel-stage') {
    const idx = parseInt(id.split('-')[2], 10);
    const fmt = FORMAT_KEYS[idx] || 'plain';
    const output = buildFormatted(pageUrl, selection, fmt, tab?.title, pageUrl);

    addClipboardItem({
      text: output, url: pageUrl, title: selection,
      format: fmt, source: 'context-menu', type: 'text'
    });
    writeClipboardViaTab(tab, output);
    return;
  }

  if (id === 'rc-sel-stage') {
    addClipboardItem({
      text: selection, url: pageUrl, title: selection,
      format: 'plain', source: 'context-menu-stage', type: 'text'
    });
    return;
  }

  // ── Copy Link ──
  if (id.startsWith('rc-link-') && id !== 'rc-link-stage') {
    const idx = parseInt(id.split('-')[2], 10);
    const fmt = FORMAT_KEYS[idx] || 'plain';
    const output = buildFormatted(linkUrl, selection || linkUrl, fmt, tab?.title, pageUrl);

    addClipboardItem({
      text: output, url: linkUrl, title: selection || linkUrl,
      format: fmt, source: 'context-menu', type: 'link'
    });
    writeClipboardViaTab(tab, output);
    return;
  }

  if (id === 'rc-link-stage') {
    const output = `[${selection || linkUrl}](${linkUrl})`;
    addClipboardItem({
      text: output, url: linkUrl, title: selection || linkUrl,
      format: 'markdown', source: 'context-menu-stage', type: 'link'
    });
    return;
  }

  // ── Tools ──
  if (id === 'rc-grab' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'openLinkGrabber' }).catch(() => {});
    return;
  }

  if (id === 'rc-scrape' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'openPageScraper' }).catch(() => {});
    return;
  }

  // ── Custom Search Engine ──
  if (id.startsWith('rc-search-')) {
    const index = parseInt(id.split('-')[2], 10);
    chrome.storage.local.get([SEARCH_KEY], data => {
      const engine = (data[SEARCH_KEY] || [])[index];
      if (!engine) return;

      let finalUrl = engine.url;
      (engine.vars || []).forEach(v => {
        if (selection && v === 'query') {
          finalUrl = finalUrl.replaceAll(`{${v}}`, encodeURIComponent(selection));
        } else {
          finalUrl = finalUrl.replaceAll(`{${v}}`, '');
        }
      });
      finalUrl = finalUrl.replaceAll('{query}', encodeURIComponent(selection));

      chrome.tabs.create({ url: finalUrl, active: true });
    });
    return;
  }

  // ── Open Dashboard ──
  if (id === 'rc-open') {
    chrome.action.openPopup?.() || chrome.runtime.sendMessage({ action: 'openPopup' });
    return;
  }
});

// Helper: write text to clipboard via the active tab's content script
function writeClipboardViaTab(tab, text) {
  if (!tab?.id) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (txt) => navigator.clipboard.writeText(txt).catch(() => {}),
    args: [text]
  }).catch(() => {});
}

/* ── Message Router ────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'addClipboardItem':
      addClipboardItem(msg.data);
      sendResponse({ ok: true });
      break;

    case 'rebuildMenu':
      rebuildContextMenu();
      sendResponse({ ok: true });
      break;

    case 'getClipboardHistory':
      chrome.storage.local.get([CLIPBOARD_KEY], data => {
        sendResponse(data[CLIPBOARD_KEY] || []);
      });
      return true; // async

    default:
      break;
  }
});

/* ── Keyboard Command Handler ──────────────────────────────────────── */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'copy_markdown' || command === 'copy_html') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const fmt  = command === 'copy_markdown' ? 'markdown' : 'html';
    const text = fmt === 'markdown'
      ? `[${tab.title}](${tab.url})`
      : `<a href="${tab.url}" target="_blank" rel="noopener">${tab.title}</a>`;

    addClipboardItem({
      text, url: tab.url, title: tab.title, format: fmt,
      source: 'keyboard-shortcut', type: 'link'
    });

    // Write to system clipboard via offscreen (best-effort)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (txt) => navigator.clipboard.writeText(txt),
        args: [text]
      });
    } catch (_) { /* clipboard write may fail in some contexts */ }
  }
});

/* ── Lifecycle ─────────────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(rebuildContextMenu);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.customSearches) {
    rebuildContextMenu();
  }
});
