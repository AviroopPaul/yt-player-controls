// Captures marketing screenshots of the extension in action into docs/assets/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const OUT = path.join(EXT, 'docs', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const VIDEO_ID = 'jNQXAC9IVRw';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytxc-shots-'));
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
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(30000);

const showControls = async () => {
  const box = await page.locator('#movie_player').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height - 25, { steps: 3 });
  }
  await page.waitForTimeout(250);
};

try {
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#movie_player video');
  await page.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    v.muted = true;
    v.loop = true;
    return v.play().catch(() => {});
  });
  const adDeadline = Date.now() + 90000;
  while (Date.now() < adDeadline) {
    const inAd = await page.evaluate(() =>
      document.querySelector('#movie_player')?.classList.contains('ad-showing')
    );
    if (!inAd) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector('.ytxc-controls');
  await page.waitForTimeout(2500);

  // 1. Controls close-up (normal view)
  await showControls();
  const ctl = await page.locator('.ytxc-controls').boundingBox();
  await page.screenshot({
    path: path.join(OUT, 'shot-controls.png'),
    clip: { x: ctl.x - 120, y: ctl.y - 60, width: ctl.width + 360, height: ctl.height + 75 },
  });

  // 2. Tooltip shot
  await showControls();
  await page.hover('.ytxc-speed');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, 'shot-tooltip.png'),
    clip: { x: ctl.x - 120, y: ctl.y - 60, width: ctl.width + 360, height: ctl.height + 75 },
  });

  // 3. Fullscreen: fill off vs on
  await showControls();
  await page.click('.ytp-fullscreen-button');
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(1200);
  await showControls();
  await page.screenshot({ path: path.join(OUT, 'shot-fill-before.png') });
  await showControls();
  await page.click('.ytxc-fill');
  await page.waitForTimeout(400);
  await showControls();
  await page.screenshot({ path: path.join(OUT, 'shot-fill-after.png') });

  // 4. Fullscreen bar close-up (big mode) with fill active
  await showControls();
  const bar = await page.locator('#movie_player .ytp-chrome-bottom').boundingBox();
  await page.screenshot({
    path: path.join(OUT, 'shot-fullscreen-bar.png'),
    clip: { x: bar.x, y: bar.y - 20, width: bar.width, height: bar.height + 30 },
  });

  console.log('captured:', fs.readdirSync(OUT).filter((f) => f.startsWith('shot-')).join(', '));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
