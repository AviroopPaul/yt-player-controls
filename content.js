(() => {
  'use strict';

  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 3;
  const NS = 'http://www.w3.org/2000/svg';

  let fillOn = false;
  let fillBtn = null;
  let speedLabel = null;
  let observedVideo = null;
  let resizeObserver = null;
  let toastTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const getPlayer = () => $('#movie_player');
  const getVideo = () => {
    const p = getPlayer();
    if (!p) return null;
    return p.querySelector('video.html5-main-video') || p.querySelector('video');
  };

  function icon(paths) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const spec of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', spec.d);
      if (spec.fill) {
        p.setAttribute('fill', 'currentColor');
      } else {
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', 'currentColor');
        p.setAttribute('stroke-width', '2');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
      }
      svg.appendChild(p);
    }
    return svg;
  }

  const ICONS = {
    fill: [
      { d: 'M9 4H6a2 2 0 0 0-2 2v3' },
      { d: 'M15 4h3a2 2 0 0 1 2 2v3' },
      { d: 'M9 20H6a2 2 0 0 1-2-2v-3' },
      { d: 'M15 20h3a2 2 0 0 0 2-2v-3' },
    ],
    pip: [
      { d: 'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z' },
      { d: 'M12.5 11.5H19V16h-6.5z', fill: true },
    ],
    link: [
      { d: 'M10.6 13.4a4.4 4.4 0 0 0 6.22 0l2.9-2.9a4.4 4.4 0 1 0-6.22-6.22l-1.45 1.44' },
      { d: 'M13.4 10.6a4.4 4.4 0 0 0-6.22 0l-2.9 2.9a4.4 4.4 0 1 0 6.22 6.22l1.44-1.44' },
    ],
  };

  function mkButton(cls, label, child, onClick) {
    const b = document.createElement('button');
    b.className = `ytp-button ytxc-btn ${cls}`;
    b.setAttribute('aria-label', label);
    // Inline layout styles: YouTube ships different .ytp-button CSS per
    // account variant, and equal-specificity page rules can beat the
    // extension stylesheet, leaving text glyphs off-center in the box.
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.justifyContent = 'center';
    b.style.textAlign = 'center';
    if (child) b.appendChild(child);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
    b.addEventListener('mouseenter', () => showTooltip(b));
    b.addEventListener('mouseleave', hideTooltip);
    b.addEventListener('focus', () => showTooltip(b));
    b.addEventListener('blur', hideTooltip);
    return b;
  }

  // --- Tooltip (YouTube-style, centered above the button; the native title
  // tooltip renders at the cursor with an offset, so we roll our own) ---

  let tooltipEl = null;

  function ensureTooltip() {
    const player = getPlayer();
    if (!player) return null;
    if (!tooltipEl || !player.contains(tooltipEl)) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'ytxc-tooltip';
      player.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function anchorRect(btn) {
    // Anchor to the visible glyph (icon or text), not the button box: some
    // player variants style .ytp-button so the content sits off-center, and
    // the tooltip must sit over what the user actually sees.
    const br = btn.getBoundingClientRect();
    let cr = null;
    const svg = btn.querySelector('svg');
    if (svg) {
      cr = svg.getBoundingClientRect();
    } else if (btn.firstChild && btn.firstChild.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.selectNodeContents(btn);
      cr = range.getBoundingClientRect();
    }
    if (!cr || !cr.width) return br;
    return { left: cr.left, width: cr.width, top: Math.min(br.top, cr.top) };
  }

  function positionTooltip(btn) {
    const player = getPlayer();
    const t = tooltipEl;
    if (!player || !t) return;
    const pr = player.getBoundingClientRect();
    const br = anchorRect(btn);
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    let left = br.left - pr.left + br.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, pr.width - tw - 8));
    const top = br.top - pr.top - th - 8;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
    // The tooltip's containing block is not guaranteed to be the player
    // (YouTube ships different player layouts per account). Measure where
    // the tooltip actually landed and shift by the difference.
    const tr = t.getBoundingClientRect();
    const dx = pr.left + left - tr.left;
    const dy = pr.top + top - tr.top;
    if (dx || dy) {
      t.style.left = `${left + dx}px`;
      t.style.top = `${top + dy}px`;
    }
  }

  let tipBtn = null;
  let tipRaf = 0;

  function showTooltip(btn) {
    const t = ensureTooltip();
    if (!t) return;
    tipBtn = btn;
    t.textContent = btn.getAttribute('aria-label') || '';
    t.classList.add('ytxc-tooltip-visible');
    positionTooltip(btn);
    // Keep tracking briefly: hover animations and late layout can move the button.
    cancelAnimationFrame(tipRaf);
    let frames = 20;
    const track = () => {
      if (tipBtn !== btn || !t.classList.contains('ytxc-tooltip-visible')) return;
      positionTooltip(btn);
      if (--frames > 0) tipRaf = requestAnimationFrame(track);
    };
    tipRaf = requestAnimationFrame(track);
  }

  function hideTooltip() {
    tipBtn = null;
    cancelAnimationFrame(tipRaf);
    if (tooltipEl) tooltipEl.classList.remove('ytxc-tooltip-visible');
  }

  function toast(msg) {
    const player = getPlayer() || document.body;
    let t = player.querySelector('.ytxc-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'ytxc-toast';
      player.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('ytxc-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('ytxc-toast-visible'), 1500);
  }

  // --- Speed ---

  const formatRate = (r) => `${parseFloat(r.toFixed(2))}×`;

  function updateSpeedLabel() {
    if (!speedLabel) return;
    const v = getVideo();
    speedLabel.textContent = formatRate(v ? v.playbackRate : 1);
  }

  function setSpeed(rate) {
    const v = getVideo();
    if (!v) return;
    v.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate / STEP) * STEP));
    updateSpeedLabel();
  }

  function bumpSpeed(delta) {
    const v = getVideo();
    if (v) setSpeed(v.playbackRate + delta);
  }

  // --- Fill screen ---

  function applyFill() {
    const player = getPlayer();
    const video = getVideo();
    if (!player || !video) return;
    if (!fillOn) {
      video.style.removeProperty('transform');
      return;
    }
    const pw = player.clientWidth;
    const ph = player.clientHeight;
    const vw = video.clientWidth;
    const vh = video.clientHeight;
    if (!pw || !ph || !vw || !vh) return;
    const scale = Math.max(pw / vw, ph / vh);
    if (scale > 1.005) {
      video.style.transform = `scale(${scale.toFixed(4)})`;
    } else {
      video.style.removeProperty('transform');
    }
  }

  function toggleFill() {
    fillOn = !fillOn;
    if (fillBtn) fillBtn.classList.toggle('ytxc-on', fillOn);
    const p = getPlayer();
    if (p) p.classList.toggle('ytxc-fill-active', fillOn);
    applyFill();
    toast(fillOn ? 'Fill screen on' : 'Fill screen off');
  }

  // --- Picture in picture ---

  async function togglePip() {
    const v = getVideo();
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        if (v.hasAttribute('disablepictureinpicture')) v.removeAttribute('disablepictureinpicture');
        await v.requestPictureInPicture();
      }
    } catch (err) {
      toast('PiP unavailable');
      console.warn('[ytxc] PiP failed:', err);
    }
  }

  // --- Copy link ---

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  async function copyLink() {
    const id = currentVideoId();
    const url = id ? `https://youtu.be/${id}` : location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {}
      ta.remove();
    }
    toast(ok ? 'Link copied' : 'Copy failed');
  }

  // --- Injection ---

  function buildControls() {
    const wrap = document.createElement('div');
    wrap.className = 'ytxc-controls';

    fillBtn = mkButton('ytxc-fill', 'Fill screen', icon(ICONS.fill), toggleFill);
    if (fillOn) fillBtn.classList.add('ytxc-on');

    const minus = mkButton('ytxc-minus ytxc-text', 'Slower', null, () => bumpSpeed(-STEP));
    minus.textContent = '−';

    speedLabel = mkButton('ytxc-speed ytxc-text', 'Speed (click to reset)', null, () => setSpeed(1));

    const plus = mkButton('ytxc-plus ytxc-text', 'Faster', null, () => bumpSpeed(STEP));
    plus.textContent = '+';

    const pip = mkButton('ytxc-pip', 'Picture in picture', icon(ICONS.pip), togglePip);
    const copy = mkButton('ytxc-copy', 'Copy video link', icon(ICONS.link), copyLink);

    wrap.append(fillBtn, minus, speedLabel, plus, pip, copy);
    return wrap;
  }

  function refreshObservers() {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => {
      if (fillOn) applyFill();
    });
    const p = getPlayer();
    if (p) resizeObserver.observe(p);
    if (observedVideo) resizeObserver.observe(observedVideo);
  }

  function inject() {
    const rc = $('#movie_player .ytp-right-controls');
    if (rc && !rc.querySelector('.ytxc-controls')) {
      rc.prepend(buildControls());
      updateSpeedLabel();
    }
    const v = getVideo();
    if (v && v !== observedVideo) {
      observedVideo = v;
      refreshObservers();
      updateSpeedLabel();
      if (fillOn) applyFill();
    }
  }

  let scheduled = false;
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      inject();
    });
  }

  document.addEventListener(
    'ratechange',
    (e) => {
      if (e.target && e.target.tagName === 'VIDEO') updateSpeedLabel();
    },
    true
  );
  document.addEventListener(
    'loadedmetadata',
    (e) => {
      if (e.target && e.target.tagName === 'VIDEO') {
        updateSpeedLabel();
        if (fillOn) applyFill();
      }
    },
    true
  );
  window.addEventListener('resize', () => {
    if (fillOn) applyFill();
  });
  window.addEventListener('yt-navigate-finish', scheduleInject);

  const mo = new MutationObserver(scheduleInject);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  inject();
})();
