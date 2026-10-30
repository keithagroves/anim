// Runs the demo's questions through the real model on the live canvas and saves the answers
// (what the AI said and drew, sentence by sentence) to conversation.json.
// Usage: node walkthroughs/game-architect/tools/capture.mjs   (canvas dev server on :5180)
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const QUESTIONS = [
  "I'm building a little space shooter in the browser, just me on weekends, and I'm using Phaser. Where do I start?",
  "Okay, I've got a ship flying around and enemies coming at me. Now I want accounts and a global leaderboard. Firebase or Supabase?",
  "I've used Firebase before, so let's go Firebase. How do scores get into the leaderboard without people cheating?",
  "That's working. Now my friends want to fly together in real time. What changes?",
  "Let's do a server, I don't want cheaters. Can you show me the whole thing now?",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:5180/");
await page.waitForSelector('input[placeholder*="type a question"]');
await page.evaluate(() => {
  // No real voice: a stand-in that "speaks" quickly, so capturing doesn't take minutes.
  speechSynthesis.speak = (u) => { setTimeout(() => u.onstart?.(), 10); setTimeout(() => u.onend?.(), 200); };
  speechSynthesis.cancel = () => {};
  window.talkDemo.handsFree(false);
});
for (const [i, q] of QUESTIONS.entries()) {
  await page.fill('input[placeholder*="type a question"]', q);
  await page.press('input[placeholder*="type a question"]', "Enter");
  await page.waitForFunction((n) => (window.talkLog?.length ?? 0) > n, i, { timeout: 180000, polling: 500 });
  console.log(`answered ${i + 1}/${QUESTIONS.length}: ${q}`);
}
const log = await page.evaluate(() => window.talkLog);
writeFileSync(new URL("../conversation.json", import.meta.url), JSON.stringify(log, null, 2));
await page.screenshot({ path: new URL("../build/capture.png", import.meta.url).pathname });
await browser.close();
