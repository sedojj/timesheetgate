// Isolated-world content script. While recording is on (chrome.storage.local.recording),
// it logs user interactions, added DOM nodes, network traffic (from page-hook.js), form
// submissions and HTML snapshots. Each batch is stored under its own `log_*` key, so
// frames and tabs never overwrite each other.
(() => {
  const FRAME = window === window.top ? 'top' : 'iframe';
  const INTERACTIVE = 'a,button,input,select,textarea,label,[role],[onclick],[tabindex]';
  const HTML_LIMIT = 8 * 1024 * 1024;
  const MUTATIONS_PER_SECOND = 40;

  let recording = false;
  let started = false;
  let buffer = [];
  let mutationBudget = MUTATIONS_PER_SECOND;
  let mutationsDropped = 0;

  const key = () => `log_${String(Date.now()).padStart(15, '0')}_${Math.random().toString(36).slice(2, 8)}`;

  function store(entries) {
    try {
      chrome.storage.local.set({ [key()]: entries });
    } catch (e) {
      /* extension reloaded: context invalidated */
    }
  }

  function log(type, data) {
    if (!recording) return;
    buffer.push({ t: new Date().toISOString(), type, frame: FRAME, url: location.href, ...data });
  }

  function flush() {
    if (mutationsDropped) {
      log('mutations_dropped', { count: mutationsDropped });
      mutationsDropped = 0;
    }
    if (!buffer.length) return;
    const entries = buffer;
    buffer = [];
    store(entries);
  }

  // ── Element description ───────────────────────────
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 8; n = n.parentElement) {
      if (n.id) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      let part = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  const text = (n, max = 150) => (n && (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max)) || undefined;

  function labelOf(el) {
    if (el.labels && el.labels[0]) return text(el.labels[0]);
    const by = el.getAttribute('aria-labelledby');
    if (by) return text(document.getElementById(by.split(' ')[0]));
    return text(el.closest('label'));
  }

  function cellOf(el) {
    const tr = el.closest('tr');
    if (!tr) return undefined;
    const td = el.closest('td,th');
    const table = tr.closest('table');
    let header;
    if (table && td && table.tHead && table.tHead.rows.length) {
      const hr = table.tHead.rows[table.tHead.rows.length - 1];
      header = text(hr.cells[td.cellIndex], 60);
    }
    return {
      table: (table && (table.id || table.className)) || undefined,
      rowId: tr.id || undefined,
      row: tr.rowIndex,
      col: td ? td.cellIndex : undefined,
      header,
      rowText: text(tr, 200),
    };
  }

  function valueOf(el) {
    if (el.type === 'password') return { value: '[redacted]' };
    const v = {};
    if (typeof el.value === 'string' && el.tagName !== 'BUTTON') v.value = el.value;
    if (el.type === 'checkbox' || el.type === 'radio') v.checked = el.checked;
    if (el.tagName === 'SELECT') {
      v.selectedText = el.selectedOptions[0] && el.selectedOptions[0].text;
      v.optionCount = el.options.length;
    }
    return v;
  }

  function describe(el) {
    if (!(el instanceof Element)) return undefined;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      cls: typeof el.className === 'string' && el.className ? el.className : undefined,
      type: el.getAttribute('type') || undefined,
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      title: el.getAttribute('title') || undefined,
      href: el.getAttribute('href') || undefined,
      onclick: (el.getAttribute('onclick') || '').slice(0, 300) || undefined,
      text: el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? undefined : text(el),
      label: labelOf(el),
      selector: cssPath(el),
      cell: cellOf(el),
      ...valueOf(el),
    };
  }

  function formSummary(form) {
    if (!(form instanceof HTMLFormElement)) return undefined;
    return {
      id: form.id || undefined,
      name: form.getAttribute('name') || undefined,
      action: form.action,
      method: form.method,
      fields: [...form.elements]
        .filter((el) => el.name)
        .slice(0, 5000)
        .map((el) => ({ name: el.name, tag: el.tagName.toLowerCase(), type: el.type, ...valueOf(el) })),
    };
  }

  function snapshot(reason) {
    if (!recording || !document.documentElement) return;
    let html = document.documentElement.outerHTML;
    if (html.length > HTML_LIMIT) html = `${html.slice(0, HTML_LIMIT)}…[truncated]`;
    flush();
    store([
      {
        t: new Date().toISOString(),
        type: 'snapshot',
        reason,
        frame: FRAME,
        url: location.href,
        title: document.title,
        forms: [...document.forms].map(formSummary),
        html,
      },
    ]);
  }

  // ── Listeners (capture phase, so the page cannot hide events from us) ──
  const inputTimers = new WeakMap();

  function listen() {
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const interactive = target && target.closest(INTERACTIVE);
        log('click', { target: describe(target), interactive: interactive !== target ? describe(interactive) : undefined });
        if (interactive && interactive.matches('a,button,input[type=submit],input[type=button]')) setTimeout(flush, 0);
      },
      true,
    );
    document.addEventListener('change', (e) => log('change', { target: describe(e.target) }), true);
    document.addEventListener(
      'input',
      (e) => {
        const el = e.target;
        clearTimeout(inputTimers.get(el));
        inputTimers.set(el, setTimeout(() => log('input', { target: describe(el) }), 500));
      },
      true,
    );
    document.addEventListener('focusin', (e) => log('focus', { target: describe(e.target) }), true);
    document.addEventListener(
      'keydown',
      (e) => {
        if (['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          log('key', { key: e.key, target: describe(e.target) });
        }
      },
      true,
    );
    document.addEventListener(
      'submit',
      (e) => {
        log('submit', { form: formSummary(e.target), submitter: describe(e.submitter) });
        flush();
      },
      true,
    );
    document.addEventListener('__timelog_net', (e) => {
      try {
        log('net', JSON.parse(e.detail));
      } catch (err) {
        /* ignore */
      }
    });
    window.addEventListener('pagehide', flush);
  }

  function observe() {
    setInterval(() => (mutationBudget = MUTATIONS_PER_SECOND), 1000);
    new MutationObserver((mutations) => {
      if (!recording) return;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (mutationBudget-- <= 0) {
            mutationsDropped++;
            continue;
          }
          log('added', {
            node: { tag: n.tagName.toLowerCase(), id: n.id || undefined, cls: typeof n.className === 'string' ? n.className : undefined },
            parent: m.target instanceof Element ? cssPath(m.target) : undefined,
            text: text(n, 300),
            html: n.outerHTML.slice(0, 2000),
          });
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function start() {
    if (started) return;
    started = true;
    log('page_load', { title: document.title, referrer: document.referrer });
    try {
      const pending = sessionStorage.getItem('__timelog_pending_submit');
      if (pending) {
        sessionStorage.removeItem('__timelog_pending_submit');
        log('form_post', JSON.parse(pending));
      }
    } catch (e) {
      /* ignore */
    }
    const ready = () => {
      observe();
      setTimeout(() => snapshot('page_load'), 1500);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }

  listen();
  setInterval(flush, 1000);

  chrome.storage.local.get('recording').then((r) => {
    recording = r.recording === true;
    if (recording) start();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.recording) {
      recording = changes.recording.newValue === true;
      if (recording && started) snapshot('recording_started');
      else if (recording) start();
      else flush();
    }
    if (changes.snapshotRequest && recording) snapshot('manual');
  });
})();
