import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

// "Me at the zoo": 4:3 aspect, so fullscreen on a 16:10 viewport shows bars for fill to remove.
const VIDEO_ID = 'jNQXAC9IVRw';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytxc-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--lang=en-US',
  ],
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: 'https://www.youtube.com',
});

const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(20000);

const videoRate = () =>
  page.evaluate(() => document.querySelector('#movie_player video').playbackRate);

const geom = () =>
  page.evaluate(() => {
    const p = document.querySelector('#movie_player');
    const v = p.querySelector('video');
    const t = getComputedStyle(v).transform;
    const m = new DOMMatrixReadOnly(t === 'none' ? '' : t);
    return { pw: p.clientWidth, ph: p.clientHeight, vw: v.clientWidth, vh: v.clientHeight, scale: m.a };
  });

const showControls = async () => {
  const box = await page.locator('#movie_player').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height - 25, { steps: 3 });
  }
  await page.waitForTimeout(250);
};

const clickCtl = async (sel) => {
  await showControls();
  await page.click(sel);
  await page.waitForTimeout(200);
};

try {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Best-effort consent dismissal (region dependent)
  for (const sel of [
    'button[aria-label="Accept all"]',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button[aria-label="Reject all"]',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
      break;
    }
  }

  await page.waitForSelector('#movie_player video', { timeout: 45000 });
  await page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    v.muted = true;
    v.loop = true; // test video is 19s; keep it playing for the whole run
    return v.play().catch(() => {});
  });

  // Wait out / skip any pre-roll ad
  const adDeadline = Date.now() + 90000;
  while (Date.now() < adDeadline) {
    const inAd = await page.evaluate(() =>
      document.querySelector('#movie_player')?.classList.contains('ad-showing')
    );
    if (!inAd) break;
    const skip = page
      .locator('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')
      .first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 1. Controls injected
  await page.waitForSelector('.ytxc-controls', { timeout: 20000 });
  const present = await page.evaluate(() =>
    ['.ytxc-fill', '.ytxc-minus', '.ytxc-speed', '.ytxc-plus', '.ytxc-pip', '.ytxc-copy'].map(
      (s) => !!document.querySelector(`.ytp-right-controls ${s}`)
    )
  );
  record('controls injected into player bar', present.every(Boolean), JSON.stringify(present));
  await showControls();
  await page
    .locator('#movie_player .ytp-chrome-bottom')
    .screenshot({ path: path.join(SHOTS, '01-player-bar.png') })
    .catch(() => page.screenshot({ path: path.join(SHOTS, '01-player-bar.png') }));

  // 1b. Tooltips: custom tooltip centered directly above the button, no native title tooltip
  const noTitles = await page.evaluate(() =>
    [...document.querySelectorAll('.ytxc-btn')].every((b) => !b.hasAttribute('title'))
  );
  record('no native title attributes on buttons', noTitles);
  const measureTip = (sel) =>
    page.evaluate((s) => {
      const t = document.querySelector('.ytxc-tooltip');
      const b = document.querySelector(s);
      if (!t || !b) return null;
      const tr = t.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      let cr = null;
      const svg = b.querySelector('svg');
      if (svg) {
        cr = svg.getBoundingClientRect();
      } else {
        const range = document.createRange();
        range.selectNodeContents(b);
        cr = range.getBoundingClientRect();
      }
      if (!cr || !cr.width) cr = br;
      return {
        visible: getComputedStyle(t).opacity === '1',
        text: t.textContent,
        dxButton: +Math.abs(tr.left + tr.width / 2 - (br.left + br.width / 2)).toFixed(2),
        dxGlyph: +Math.abs(tr.left + tr.width / 2 - (cr.left + cr.width / 2)).toFixed(2),
        above: tr.bottom <= br.top,
        gap: Math.round(br.top - tr.bottom),
      };
    }, sel);

  for (const sel of ['.ytxc-minus', '.ytxc-speed', '.ytxc-plus', '.ytxc-copy']) {
    await showControls();
    await page.hover(sel);
    await page.waitForTimeout(450);
    const tip = await measureTip(sel);
    record(
      `tooltip centered above ${sel} glyph`,
      !!tip && tip.visible && tip.above && tip.dxGlyph < 2,
      JSON.stringify(tip)
    );
  }
  await showControls();
  await page.hover('.ytxc-speed');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '01b-tooltip.png') });
  const tipHides = await (async () => {
    await page.hover('#movie_player .ytp-play-button').catch(() => {});
    await page.mouse.move(200, 200);
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const t = document.querySelector('.ytxc-tooltip');
      return !t || getComputedStyle(t).opacity === '0';
    });
  })();
  record('tooltip hides on mouse leave', tipHides);

  // 1c. Adversarial: simulate a YouTube UI variant whose CSS shoves the text
  // glyph off-center inside the button; the tooltip must follow the glyph.
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'ytxc-adversarial';
    st.textContent =
      '.ytp-button.ytxc-minus { justify-content: flex-start !important; width: 48px !important; }';
    document.head.appendChild(st);
  });
  await showControls();
  await page.hover('.ytxc-minus');
  await page.waitForTimeout(450);
  const advTip = await measureTip('.ytxc-minus');
  record(
    'tooltip tracks glyph under hostile page CSS',
    !!advTip && advTip.visible && advTip.dxGlyph < 2 && advTip.dxButton > 5,
    JSON.stringify(advTip)
  );
  await page.evaluate(() => document.getElementById('ytxc-adversarial')?.remove());

  // 2. Speed controls
  const rate0 = await videoRate();
  await clickCtl('.ytxc-plus');
  const rate1 = await videoRate();
  const label1 = (await page.textContent('.ytxc-speed'))?.trim();
  record('speed + steps 1 to 1.25', rate0 === 1 && rate1 === 1.25, `rate0=${rate0} rate1=${rate1}`);
  record('speed label shows 1.25x', label1 === '1.25×', `label=${label1}`);
  await clickCtl('.ytxc-minus');
  await clickCtl('.ytxc-minus');
  const rate2 = await videoRate();
  record('speed - steps 1.25 to 0.75', rate2 === 0.75, `rate=${rate2}`);
  await clickCtl('.ytxc-speed');
  const rate3 = await videoRate();
  record('speed label click resets to 1', rate3 === 1, `rate=${rate3}`);

  // 3. Copy link
  await page.bringToFront();
  await clickCtl('.ytxc-copy');
  const clip = await page
    .evaluate(() => navigator.clipboard.readText())
    .catch((e) => `ERROR: ${e.message}`);
  record('copy link puts short URL on clipboard', clip === `https://youtu.be/${VIDEO_ID}`, `clipboard=${clip}`);

  // 4. Picture in picture
  await clickCtl('.ytxc-pip');
  const pipOn = await page
    .waitForFunction(() => !!document.pictureInPictureElement, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  record('PiP button enters picture in picture', pipOn);
  await clickCtl('.ytxc-pip');
  const pipOff = await page
    .waitForFunction(() => !document.pictureInPictureElement, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  record('PiP button exits picture in picture', pipOff);

  // 5. Fill screen in normal view (scale must match player/video geometry)
  const g0 = await geom();
  await clickCtl('.ytxc-fill');
  const g1 = await geom();
  const expected1 = Math.max(g1.pw / g1.vw, g1.ph / g1.vh);
  const okNormal =
    expected1 > 1.005 ? Math.abs(g1.scale - expected1) < 0.02 : Math.abs(g1.scale - 1) < 0.001;
  record(
    'fill screen scales correctly (normal view)',
    okNormal,
    `scale=${g1.scale.toFixed(4)} expected=${expected1.toFixed(4)} player=${g1.pw}x${g1.ph} video=${g1.vw}x${g1.vh} (before=${g0.scale})`
  );
  await page.screenshot({ path: path.join(SHOTS, '02-fill-on-normal.png') });
  await clickCtl('.ytxc-fill');
  const g2 = await geom();
  record('fill screen toggles off', Math.abs(g2.scale - 1) < 0.001, `scale=${g2.scale}`);

  // 6. Fill screen in fullscreen (the headline use case)
  await showControls();
  await page.click('.ytp-fullscreen-button');
  const fsOn = await page
    .waitForFunction(() => !!document.fullscreenElement, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  record('entered fullscreen', fsOn);
  if (fsOn) {
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOTS, '03-fullscreen-before-fill.png') });
    await clickCtl('.ytxc-fill');
    const g3 = await geom();
    const expected3 = Math.max(g3.pw / g3.vw, g3.ph / g3.vh);
    record(
      'fill screen removes black bars in fullscreen',
      expected3 > 1.05 && Math.abs(g3.scale - expected3) < 0.02,
      `scale=${g3.scale.toFixed(4)} expected=${expected3.toFixed(4)} player=${g3.pw}x${g3.ph} video=${g3.vw}x${g3.vh}`
    );
    await page.screenshot({ path: path.join(SHOTS, '04-fullscreen-after-fill.png') });
    await showControls();
    await page.hover('.ytxc-speed');
    await page.waitForTimeout(450);
    const fsTip = await measureTip('.ytxc-speed');
    record(
      'tooltip centered above .ytxc-speed (fullscreen)',
      !!fsTip && fsTip.visible && fsTip.above && fsTip.dxGlyph < 2,
      JSON.stringify(fsTip)
    );
    await page
      .locator('#movie_player .ytp-chrome-bottom')
      .screenshot({ path: path.join(SHOTS, '05-fullscreen-bar.png') })
      .catch(() => {});
    await clickCtl('.ytxc-fill');
    const g4 = await geom();
    record('fill screen toggles off in fullscreen', Math.abs(g4.scale - 1) < 0.001, `scale=${g4.scale}`);
    await page.keyboard.press('Escape');
    await page
      .waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 })
      .catch(() => {});
  }
} catch (err) {
  record('unhandled error', false, String((err && err.message) || err));
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
