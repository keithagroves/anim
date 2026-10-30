// A developer talks a space shooter's architecture through with the canvas AI. The AI's answers are real
// model output (captured by tools/capture.mjs, trimmed by tools/curate.py into script.json); here they're
// replayed on the real canvas in time with the recorded voices: the developer in one voice, the AI in another.
import { readFileSync } from 'node:fs'

const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url)))
const narration = JSON.parse(readFileSync(new URL('./build/narration.json', import.meta.url)))
/** Measured time from the end of a question to the AI's first word in the real app. */
const THINK_MS = 1500
const GAP_MS = 300 // walkthrough.json "gap", already waited after every line

export default async function scenes(h) {
  const { say } = h
  const page = h.page
  await h.open()
  await page.waitForFunction(() => window.talkDemo && window.editor)
  await page.evaluate(() => {
    window.talkDemo.handsFree(false)
    speechSynthesis.speak = () => {} // the voices come from the recording
    // The mic button starts Chrome's speech recognition; here the developer's words arrive from the script.
    window.webkitSpeechRecognition = window.SpeechRecognition = class { start() {} stop() {} abort() {} }
  })
  await h.wait(800)

  let firstAnswer = true
  for (const line of script) {
    if (line.key.startsWith('you')) {
      await h.tap('css=button[title^="Talk"]', { settle: 200 })
      // The words show up as they're spoken, like Chrome's live transcript.
      await say(line.key, async (at) => {
        const words = narration.words[line.key]
        for (let i = 0; i < words.length; i++) {
          await at(words[i][1])
          await page.evaluate((t) => window.talkDemo.interim(t), words.slice(0, i + 1).map((w) => w[0]).join(' '))
        }
      })
      await page.evaluate((t) => window.talkDemo.heard(t), line.say)
      await h.park()
      await h.wait(THINK_MS - GAP_MS)
      firstAnswer = true
    } else {
      await say(line.key, async () => {
        await page.evaluate((t) => window.talkDemo.said(t), line.say)
        if (firstAnswer) { firstAnswer = false; await page.evaluate((ms) => window.talkDemo.timing(`speaking ${(ms / 1000).toFixed(1)}s`), THINK_MS) }
        // Each sentence's drawing plays while it's spoken, one command after another, as in the live app.
        for (const cmd of line.cmds) await page.evaluate((c) => window.talkDemo.run(c), cmd)
      })
    }
  }
  await h.wait(1500)
}
