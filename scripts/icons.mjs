// Package the supplied logo for PWA sizes without changing the source artwork.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const asset = new URL("../public/brand/feeledu-logo.png", import.meta.url);
const data = readFileSync(asset).toString("base64");
const browser = await chromium.launch({ headless: true });
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:white}body{display:flex;align-items:center;justify-content:center}img{width:84%;height:auto}</style><img src="data:image/png;base64,${data}" alt="FEEL EDU">`,
    );
    await page.locator("img").evaluate((image) => image.decode());
    await page.screenshot({
      path: fileURLToPath(
        new URL(`../public/icon-${size}.png`, import.meta.url),
      ),
    });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(
  new URL("../public/icon.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="white"/><image href="data:image/png;base64,${data}" x="40" y="157" width="432" height="198"/></svg>`,
);
