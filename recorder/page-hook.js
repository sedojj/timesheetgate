// Runs in the page's own JS world (MAIN) so it can wrap fetch and XHR before the page
// uses them. It cannot use chrome.* APIs: it hands each request to recorder.js through a
// DOM event, and recorder.js decides whether to keep it (only while recording).
(() => {
  const EVENT = '__timelog_net';
  const LIMIT = 50000;

  const trunc = (s) =>
    typeof s === 'string' && s.length > LIMIT ? `${s.slice(0, LIMIT)}…[+${s.length - LIMIT} chars]` : s;

  const bodyToString = (b) => {
    if (b == null) return null;
    if (typeof b === 'string') return b;
    if (b instanceof URLSearchParams) return b.toString();
    if (b instanceof FormData) {
      return JSON.stringify([...b.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `[file ${v.name}]`]));
    }
    return `[${Object.prototype.toString.call(b)}]`;
  };

  const emit = (detail) => {
    try {
      document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(detail) }));
    } catch (e) {
      /* never break the page */
    }
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init && init.method) || (input instanceof Request && input.method) || 'GET';
    const reqBody = trunc(bodyToString(init && init.body));
    const t0 = Date.now();
    const p = origFetch.apply(this, arguments);
    p.then(
      (res) =>
        res
          .clone()
          .text()
          .then(
            (text) => emit({ kind: 'fetch', url, method, reqBody, status: res.status, resBody: trunc(text), ms: Date.now() - t0 }),
            (e) => emit({ kind: 'fetch', url, method, reqBody, status: res.status, error: String(e) }),
          ),
      (e) => emit({ kind: 'fetch', url, method, reqBody, error: String(e) }),
    );
    return p;
  };

  // form.submit() fires no submit event and the page navigates at once, so the body is
  // parked in sessionStorage; recorder.js logs it on the next page load.
  const PENDING = '__timelog_pending_submit';
  const park = (form, how) => {
    try {
      const fields = [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `[file ${v.name}]`]);
      sessionStorage.setItem(
        PENDING,
        JSON.stringify({ how, at: new Date().toISOString(), url: location.href, action: form.getAttribute('action'), method: form.method, fields }),
      );
    } catch (e) {
      /* never break the page */
    }
  };
  const origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    park(this, 'submit()');
    return origSubmit.apply(this, arguments);
  };
  document.addEventListener('submit', (e) => park(e.target, 'submit event'), true);

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__timelog = { method, url: String(url) };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__timelog || {};
    const reqBody = trunc(bodyToString(body));
    const t0 = Date.now();
    this.addEventListener('loadend', () => {
      let resBody;
      try {
        resBody = this.responseType === '' || this.responseType === 'text' ? this.responseText : `[${this.responseType}]`;
      } catch (e) {
        resBody = String(e);
      }
      emit({ kind: 'xhr', ...info, reqBody, status: this.status, resBody: trunc(resBody), ms: Date.now() - t0 });
    });
    return origSend.apply(this, arguments);
  };
})();
