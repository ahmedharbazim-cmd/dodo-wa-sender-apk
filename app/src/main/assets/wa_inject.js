(function () {
window.__dodoChrome = { storage: { local: {
  get: function (k) { return Promise.resolve(JSON.parse(AndroidStore.get(JSON.stringify(k == null ? null : k)))); },
  set: function (o) { AndroidStore.set(JSON.stringify(o)); return Promise.resolve(); },
  remove: function (k) { AndroidStore.remove(JSON.stringify(k)); return Promise.resolve(); }
}, onChanged: { addListener: function () {} } } };
const chrome = window.__dodoChrome;
(async () => {
  const gen = window.__waGen = (window.__waGen || 0) + 1; // a newer run supersedes this one

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async () => { if (gen !== window.__waGen) throw new Error('superseded'); return (await chrome.storage.local.get('state')).state; };
  const patch = async p => { const s = await get(); if (!s) return; await chrome.storage.local.set({ state: { ...s, ...p } }); };
  const running = async () => !!(await get())?.running;
  const urlFor = (it, noText) => `https://web.whatsapp.com/send?phone=${it.phone}` + (noText ? '' : `&text=${encodeURIComponent(it.text)}`);

  const main = () => document.querySelector('#main');
  const headerText = () => main()?.querySelector('header')?.innerText || '';
  const composer = () => main()?.querySelector('footer [contenteditable="true"], [contenteditable="true"][data-tab]') ||
    main()?.querySelector('[contenteditable="true"]');
  const hasText = () => ((composer()?.innerText || '').replace(/\u200b/g, '').trim().length > 0);
  const findSend = root => {
    if (!root) return null;
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const icons = [...root.querySelectorAll('[data-icon]')].filter(e => /send/i.test(e.getAttribute('data-icon') || '') && vis(e));
    if (icons.length) { const ic = icons[icons.length - 1]; return ic.closest('button,[role="button"]') || ic; }
    const bs = [...root.querySelectorAll('button,[role="button"]')]
      .filter(b => /^(send|إرسال)$/i.test((b.getAttribute('aria-label') || '').trim()) && vis(b));
    return bs[bs.length - 1] || null;
  };
  const outCount = () => main()?.querySelectorAll('[data-icon^="msg-"]').length || 0;
  const sendBtn = () => findSend(main());
  const chatReady = () => hasText() || !!sendBtn();
  const diag = () => `main:${!!main()} composer:${!!composer()} text:${hasText()} btn:${!!sendBtn()}`;
  const dialog = () => document.querySelector('div[role="dialog"], div[data-animate-modal-popup="true"]');
  const appReady = () => document.querySelector('#pane-side, #side');
  const qr = () => document.querySelector('canvas[aria-label], div[data-ref], [data-testid="qrcode"]');
  // caption box of the media preview (any editable that's not the main composer / sidebar search)
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const allEditables = () => [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"]), [role="textbox"]')]
    .filter(e => !e.closest('#side, #pane-side') && visible(e));
  const labelOf = e => (e.getAttribute('aria-label') || '') + (e.getAttribute('aria-placeholder') || '') + (e.getAttribute('data-placeholder') || '');
  const labelled = () => allEditables().find(e => /caption|شرح|تعليق|وصف|add a/i.test(labelOf(e)));
  const captionBox = () => {
    const l = allEditables();
    const others = l.filter(e => e !== composer() && !composer()?.contains(e));
    return labelled() || others[others.length - 1] || (findSend(document) ? l[l.length - 1] : null) || null;
  };
  const editDiag = () => allEditables().map(e => `${e.tagName}[${labelOf(e)}|${e === composer() ? 'composer' : 'other'}]`).join(';') || 'none';
  async function typeInto(box, text) {
    const want = text.trim().split('\n')[0].slice(0, 10);
    const has = e => ((e?.innerText || '').replace(/\u200b/g, '')).includes(want);
    const ok = () => allEditables().some(has) || has(document.activeElement);
    realClick(box); box.focus(); await sleep(300);
    document.execCommand('insertText', false, text); await sleep(500);
    if (ok()) return true;
    box.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); await sleep(500);
    return ok();
  }
  const previewOpen = () => !!(findSend(document) || labelled());
  const realClick = el => {
    if (!el) return;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window }));
  };
  async function cleanup() {
    for (let i = 0; i < 3; i++) {
      for (const el of [document.activeElement, document]) 
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await sleep(400);
    }
  }

  async function waitFor(fn, timeout, step = 400) {
    const t = Date.now();
    while (Date.now() - t < timeout) { const r = fn(); if (r) return r; await sleep(step); }
    return null;
  }

  function openViaLink(item, noText) {
    const a = document.createElement('a');
    a.href = urlFor(item, noText);
    a.target = '_self';
    a.style.display = 'none';
    (document.querySelector('#app') || document.body).appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }
  function dismissDialog() {
    dialog()?.querySelector('button, [role="button"]')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }
  async function waitChat(timeout, media, before) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (media) {
        if (composer() && headerText() !== '' && headerText() !== before) { await sleep(1200); return 'ok'; }
        if (dialog() && Date.now() - t > 4000) { dismissDialog(); return 'invalid'; }
      } else {
        if (chatReady() && !dialog()) return 'ok';
        if (dialog()) { await sleep(1200); if (!chatReady()) { dismissDialog(); return 'invalid'; } }
      }
      await sleep(400);
      if (!(await running())) return 'stopped';
    }
    return 'timeout';
  }

  // ---------- text only ----------
  async function doSend() {
    await sleep(800 + Math.random() * 800);
    sendBtn()?.click();
    await sleep(2500);
    if (hasText()) {
      const c = composer();
      if (c) {
        c.focus();
        for (const type of ['keydown', 'keypress', 'keyup'])
          c.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await sleep(2500);
      }
    }
    if (hasText()) return false;
    const t = Date.now();
    while (Date.now() - t < 15000 && document.querySelector('span[data-icon="msg-time"]')) await sleep(500);
    return true;
  }

  // ---------- media / file ----------
  let cachedFile = null;
  async function getFile() {
    if (cachedFile) return cachedFile;
    const { attachment: att } = await chrome.storage.local.get('attachment');
    if (!att) return null;
    const bin = atob(att.data.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    cachedFile = new File([u], att.name, { type: att.type });
    return cachedFile;
  }
  const findPlus = () => main()?.querySelector('[data-icon*="plus"], [data-icon*="attach"], [data-icon="clip"]')?.closest('button,[role="button"]') ||
    [...(main()?.querySelectorAll('button,[role="button"]') || [])].find(b => /attach|إرفاق|ارفاق|مرفق/i.test(b.getAttribute('aria-label') || ''));
  const attachDiag = () => {
    const icons = [...new Set([...(main()?.querySelectorAll('footer [data-icon]') || [])].map(e => e.getAttribute('data-icon')))].join(',');
    const acc = [...document.querySelectorAll('input[type="file"]')].map(i => i.accept || '*').join('|');
    return `plus:${!!findPlus()} inputs:[${acc}] icons:[${icons}] preview:${previewOpen()}`;
  };
  async function attachFile(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const isMedia = /^(image|video)\//.test(file.type);
    const viaPaste = async () => {
      const c = composer();
      if (!c) return false;
      realClick(c); c.focus(); await sleep(300);
      c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return !!(await waitFor(previewOpen, 6000));
    };
    const viaInput = async () => {
      realClick(findPlus());
      await sleep(900);
      const acc = i => (i.accept || '').toLowerCase();
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      // photos&videos input has "video" in accept; the sticker input never does. Documents input accepts anything.
      const input = isMedia ? inputs.find(i => acc(i).includes('video')) : inputs.find(i => !/image|video|webp/.test(acc(i)));
      if (!input) return false;
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return !!(await waitFor(previewOpen, 6000));
    };
    const viaDrop = async () => {
      const target = main();
      if (!target) return false;
      for (const type of ['dragenter', 'dragover', 'drop'])
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      return !!(await waitFor(previewOpen, 6000));
    };
    const order = isMedia ? [['paste', viaPaste], ['input', viaInput], ['drop', viaDrop]]
                          : [['input', viaInput], ['paste', viaPaste], ['drop', viaDrop]];
    for (const [name, fn] of order) {
      if (await fn()) return name;
      await cleanup();
    }
    return '';
  }
  async function doSendMedia(item) {
    const file = await getFile();
    if (!file) return { ok: false, note: 'الملف مش موجود' };
    const how = await attachFile(file);
    if (!how) { const d = attachDiag(); await cleanup(); return { ok: false, note: 'ما قدرتش أرفق الملف | ' + d }; }
    let note = '';
    await sleep(1500);
    if (item.text) {
      const cb = await waitFor(captionBox, 5000);
      if (!cb || !(await typeInto(cb, item.text))) {
        const d = editDiag(); await cleanup();
        return { ok: false, note: 'الكابشن ما اتكتبش (اتلغى الإرسال) | ' + d };
      }
    }
    const box = captionBox();
    await sleep(800 + Math.random() * 800);
    const before = outCount();
    const isDone = () => !findSend(document) || outCount() > before;
    const btn = await waitFor(() => findSend(document), 6000);
    if (btn) realClick(btn);
    let closed = await waitFor(isDone, 8000, 400);
    if (!closed && box) { // retry with Enter
      box.focus();
      for (const type of ['keydown', 'keypress', 'keyup'])
        box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      closed = await waitFor(isDone, 8000, 400);
    }
    if (!closed) { const b2 = findSend(document); if (b2) { b2.click(); closed = await waitFor(isDone, 20000, 500); } }
    if (!closed) {
      const d = `sendBtn:${!!findSend(document)} out:${before}->${outCount()} edit:${editDiag()}`;
      await cleanup();
      return { ok: false, note: 'نافذة المعاينة فضلت مفتوحة | ' + d };
    }
    const t = Date.now();
    await sleep(800);
    const lastIcon = () => { const l = [...(main()?.querySelectorAll('[data-icon^="msg-"]') || [])]; return l[l.length - 1]?.getAttribute('data-icon') || ''; };
    while (Date.now() - t < 30000 && lastIcon() === 'msg-time') await sleep(500);
    return { ok: true, note: note || ('via:' + how) };
  }

  async function finish() { await patch({ running: false, status: 'تم الانتهاء ✅', nextAt: 0 }); }

  let s = await get();
  if (!s?.running) return;

  while (!appReady()) {
    if (qr()) await patch({ status: 'سجّل دخول بالـ QR...' });
    await sleep(1000);
    if (!(await running())) return;
  }
  await sleep(2000);

  while (true) {
    s = await get();
    if (!s?.running) return;
    if (s.index >= s.queue.length) return finish();
    const item = s.queue[s.index];
    const media = !!s.hasMedia;
    await patch({ status: `جاري الإرسال إلى ${item.phone}...` });

    let result;
    if (s.pendingNav === item.phone) {
      await patch({ pendingNav: null });
      result = await waitChat(25000, media, '');
    } else {
      if (previewOpen() && !hasText()) await cleanup();
      for (let i = 0; i < 10 && (hasText() || previewOpen()); i++) await sleep(500);
      const before = headerText();
      openViaLink(item, media);
      result = await waitChat(20000, media, before);
      if (result === 'timeout') {
        await patch({ pendingNav: item.phone, status: 'إعادة المحاولة بتحميل الصفحة...' });
        location.href = urlFor(item, media);
        return;
      }
    }
    if (result === 'stopped') return;

    let ok = false, note = '';
    if (result === 'ok') {
      if (media) { const r = await doSendMedia(item); ok = r.ok; note = r.note; }
      else { ok = await doSend(); if (!ok) note = 'الرسالة ما اتبعتتش | ' + diag(); }
    } else note = result === 'invalid' ? 'الرقم غير موجود على واتساب' : 'انتهت المهلة | ' + diag();

    s = await get();
    if (!s?.running) return;
    const sent = s.sent + (ok ? 1 : 0), failed = s.failed + (ok ? 0 : 1), index = s.index + 1;
    await chrome.storage.local.set({ state: { ...s, log: [...s.log, { phone: item.phone, ok, note }], sent, failed, index } });
    if (index >= s.queue.length) return finish();

    let delay = ok ? s.minDelay + Math.random() * (s.maxDelay - s.minDelay) : 3;
    if (ok && s.batchSize > 0 && sent % s.batchSize === 0) delay += s.batchPause * 60;
    const nextAt = Date.now() + delay * 1000;
    await patch({ nextAt, status: 'انتظار...' });
    while (Date.now() < nextAt) {
      await sleep(1000);
      if (!(await running())) return;
    }
  }
})();

})();
