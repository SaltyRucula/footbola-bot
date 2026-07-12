const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const LOGIN_URL = 'https://odivelas.scl.pt/login.php';
const RESERVATION_URL = 'https://odivelas.scl.pt/aluguercampos.php?s=16';
const TIME_ZONE = 'Europe/Lisbon';
const DEFAULT_TARGET_HOUR = '21:00';
const FOOTBALL_7_SPORT_ID = '35';
const DEFAULT_PLAYERS = '14';
const ARTIFACT_DIR = path.resolve(process.cwd(), 'reservation-artifacts');
const SAVE_ARTIFACTS = process.env.SCL_SAVE_ARTIFACTS === '1';
const FAILURE_PATTERNS = [
  /\bindispon[ií]vel\b/i,
  /\bocupad[ao]\b/i,
  /\berro\b/i,
  /\bdesculpa\b/i,
  /\besgotad[ao]\b/i,
  /\bencerrad[ao]\b/i,
  /\binv[aá]lid[ao]\b/i,
  /\bexpirad[ao]\b/i,
  /\bultrapassad[ao]\b/i,
  /\bn[aã]o\s+(foi|teve|tem|pode|conseguiu|dispon)/i,
];
const SUCCESS_PATTERNS = [
  /reserva\s+(efetuada|efectuada|confirmada|registada|realizada)/i,
  /\bsucesso\b/i,
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function lisbonParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday,
  };
}

function weekdayNumber(shortWeekday) {
  const weekdays = new Map([
    ['Sun', 0],
    ['Mon', 1],
    ['Tue', 2],
    ['Wed', 3],
    ['Thu', 4],
    ['Fri', 5],
    ['Sat', 6],
  ]);
  const value = weekdays.get(shortWeekday);
  if (value === undefined) {
    throw new Error(`Unexpected weekday from Intl formatter: ${shortWeekday}`);
  }
  return value;
}

function dateOnlyUtc(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextFridayInLisbon(now = new Date()) {
  const parts = lisbonParts(now);
  const currentWeekday = weekdayNumber(parts.weekday);
  const daysUntilFriday = (5 - currentWeekday + 7) % 7 || 7;
  const target = dateOnlyUtc(parts);
  target.setUTCDate(target.getUTCDate() + daysUntilFriday);
  return formatDate(target);
}

async function waitForSundayReleaseLisbon() {
  if (process.env.SKIP_TIME_GUARD === '1') {
    console.log('SKIP_TIME_GUARD=1 set; skipping Sunday release guard.');
    return;
  }

  const startedAt = Date.now();
  while (true) {
    const now = new Date();
    const parts = lisbonParts(now);
    const weekday = weekdayNumber(parts.weekday);
    const secondsSinceMidnight = parts.hour * 3600 + parts.minute * 60 + parts.second;

    if (weekday === 0 && secondsSinceMidnight >= 1 && secondsSinceMidnight <= 10 * 60) {
      console.log('Within the Sunday release window in Europe/Lisbon.');
      return;
    }

    if (weekday === 6 && parts.hour === 23 && parts.minute >= 30) {
      const millisecondsToRelease = ((24 * 3600) - secondsSinceMidnight + 1) * 1000;
      console.log(`Logged in; waiting ${Math.ceil(millisecondsToRelease / 1000)}s for Sunday 00:00:01 Europe/Lisbon.`);
      await new Promise((resolve) => setTimeout(resolve, millisecondsToRelease));
      continue;
    }

    const elapsedMinutes = Math.round((Date.now() - startedAt) / 60000);
    console.log(`Not in reservation window for ${TIME_ZONE}; exiting without attempting. Elapsed: ${elapsedMinutes}m.`);
    process.exit(0);
  }
}

async function chooseFirstNonEmptyOption(locator, label) {
  await locator.waitFor({ state: 'attached', timeout: 15000 });
  await locator.page().waitForFunction(
    (select) => Array.from(select.options || []).some((option) => option.value),
    await locator.elementHandle(),
    { timeout: 15000 }
  );

  const value = await locator.evaluate((select) => {
    const option = Array.from(select.options).find((item) => item.value);
    return option ? option.value : '';
  });

  if (!value) {
    throw new Error(`No selectable option found for ${label}.`);
  }

  const isVisible = await locator.isVisible().catch(() => false);
  await locator.evaluate((select, selectedValue) => {
    select.value = selectedValue;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  if (!isVisible) {
    console.log(`${label} select is hidden; selected value through DOM event.`);
  }
  console.log(`Selected ${label}: ${value}`);
  return value;
}

async function choosePriceIfAvailable(page) {
  const price = page.locator('#preco');
  await price.waitFor({ state: 'attached', timeout: 15000 });

  const value = await price.evaluate((select) => {
    const options = select.options ? Array.from(select.options) : [];
    const option = options.find((item) => item.value);
    return option ? option.value : '';
  });

  if (!value) {
    await page.evaluate(() => {
      if (typeof calculavalor === 'function') {
        calculavalor();
      }
      if (typeof enableReservar === 'function') {
        enableReservar();
      }
    });
    console.log('No price option available yet; triggered site calculation and will rely on reservation button validation.');
    return '';
  }

  await price.evaluate((select, selectedValue) => {
    select.value = selectedValue;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  console.log(`Selected price: ${value}`);
  return value;
}

async function saveArtifacts(page, prefix) {
  if (!SAVE_ARTIFACTS) {
    return;
  }

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${prefix}.png`), fullPage: true });
  await fs.writeFile(path.join(ARTIFACT_DIR, `${prefix}.html`), await page.content());
}

async function visibleTextSnippets(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map((element) => element.innerText || element.textContent || '')
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8));
}

async function sanitizedOutcomeDiagnostics(page) {
  const [title, headings, alerts, modalText, url] = await Promise.all([
    page.title().catch(() => ''),
    visibleTextSnippets(page, 'h1, h2, h3, h4, .page-header').catch(() => []),
    visibleTextSnippets(page, '.alert, .alert-danger, .alert-success, #div_informacao').catch(() => []),
    visibleTextSnippets(page, '.modal:visible, #myModal_info, #msgModal, #msgmodal').catch(() => []),
    page.url(),
  ]);

  return JSON.stringify({ url, title, headings, alerts, modalText });
}

async function verifyReservationOutcome(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  const bodyText = await page.locator('body').innerText({ timeout: 15000 });

  if (await page.locator('#password').isVisible().catch(() => false)) {
    throw new Error('Reservation failed: redirected to login page.');
  }

  const failurePattern = FAILURE_PATTERNS.find((pattern) => pattern.test(bodyText));
  if (failurePattern) {
    throw new Error(`Reservation failed: matched failure response ${failurePattern}.`);
  }

  const successPattern = SUCCESS_PATTERNS.find((pattern) => pattern.test(bodyText));
  if (successPattern) {
    console.log(`Reservation outcome matched success response ${successPattern}.`);
    if (SAVE_ARTIFACTS) {
      console.log(bodyText.slice(0, 2000));
    }
    return;
  }

  if (SAVE_ARTIFACTS) {
    console.log(bodyText.slice(0, 2000));
  }
  throw new Error(`Reservation outcome is ambiguous; sanitized diagnostics: ${await sanitizedOutcomeDiagnostics(page)}`);
}

async function run() {
  const username = requireEnv('SCL_USERNAME');
  const password = requireEnv('SCL_PASSWORD');
  const players = process.env.SCL_PLAYERS || DEFAULT_PLAYERS;
  const dryRun = process.env.SCL_DRY_RUN === '1';
  const targetDate = process.env.SCL_TARGET_DATE || nextFridayInLisbon();
  const targetHour = process.env.SCL_TARGET_HOUR || DEFAULT_TARGET_HOUR;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    page.setDefaultTimeout(30000);
    console.log(`Logging in with configured SCL_USERNAME. Target date: ${targetDate}; target time: ${targetHour}.`);

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(username);
    await page.locator('#password').fill(password);
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.locator('button[type="submit"]').click(),
    ]);

    if (await page.locator('#password').isVisible().catch(() => false)) {
      throw new Error('Login appears to have failed; password field is still visible.');
    }

    await waitForSundayReleaseLisbon();

    const reservationUrl = `${RESERVATION_URL}&dia=${targetDate}&desporto=${FOOTBALL_7_SPORT_ID}`;
    await page.goto(reservationUrl, { waitUntil: 'networkidle' });

    const targetButton = page.locator('button.btn_reserva', { hasText: targetHour }).first();
    const targetButtonCount = await page.locator('button.btn_reserva').count();
    if (targetButtonCount === 0) {
      throw new Error(`No reservation time buttons found for ${targetDate}. Check that SCL_TARGET_DATE is a valid bookable date.`);
    }

    await targetButton.waitFor({ state: 'visible', timeout: 15000 });

    const classes = await targetButton.getAttribute('class');
    const hasClickHandler = await targetButton.evaluate((button) => Boolean(button.getAttribute('onclick')));
    if ((classes || '').includes('btn_cinza') || !hasClickHandler) {
      throw new Error(`The ${targetHour} slot is not available for booking yet or has no reservation action.`);
    }

    await targetButton.click();
    await page.locator('#myModal').waitFor({ state: 'visible', timeout: 30000 });

    await chooseFirstNonEmptyOption(page.locator('#tempo'), 'duration');
    await choosePriceIfAvailable(page);

    const playersInput = page.locator('#njogadores');
    if (await playersInput.isVisible().catch(() => false)) {
      await playersInput.fill(players);
      await playersInput.dispatchEvent('change');
    }

    const paymentReference = page.locator('input[name="forma_pagamento"][value="1"]');
    if (await paymentReference.isVisible().catch(() => false)) {
      await paymentReference.check();
    }

    const terms = page.locator('input[name="condicoes"]');
    if (await terms.isVisible().catch(() => false)) {
      await terms.check();
    }

    await page.waitForFunction(() => {
      const button = document.querySelector('#mymodalsubmit');
      return button && !button.disabled;
    }, { timeout: 15000 });

    if (dryRun) {
      console.log('SCL_DRY_RUN=1 set; stopping before the final Reservar click.');
      await saveArtifacts(page, 'dry-run-ready-to-submit');
      return;
    }

    console.log('Submitting reservation attempt.');
    await page.locator('#mymodalsubmit').click();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    await verifyReservationOutcome(page);
    await saveArtifacts(page, 'reservation-result');
  } catch (error) {
    await saveArtifacts(page, 'reservation-error').catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
