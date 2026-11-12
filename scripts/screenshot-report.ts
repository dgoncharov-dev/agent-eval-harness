import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [inputArg, outArg] = process.argv.slice(2);
if (!inputArg) {
  console.error("Usage: npm run screenshot -- <report.html> [out.png]");
  process.exit(1);
}
const inputPath = resolve(inputArg);
const outPath = outArg ? resolve(outArg) : fileURLToPath(new URL("../docs/report.png", import.meta.url));

try {
  await stat(inputPath);
} catch {
  console.error(`Report file not found: ${inputPath}`);
  process.exit(1);
}

try {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("If the browser is missing, run: npx playwright install chromium");
    process.exit(1);
  }
  try {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 900 },
      colorScheme: "light",
      deviceScaleFactor: 2,
    });
    // The report makes no requests, so anything but the local file itself is a bug: block it and say so.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file:")) return route.continue();
      console.warn(`WARNING: blocked network request: ${url}`);
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "load" });
    await mkdir(dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
  const { size } = await stat(outPath);
  console.log(`${outPath} (${(size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
