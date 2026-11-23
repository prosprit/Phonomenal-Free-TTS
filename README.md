# Phonomenal Free TTS

Before you say anything, yes this was put together with AI. I honestly just wanted a quick, nice sounding TTS for my mom so sue me. Everything else on the chrome extension store sounded so bad and was trying to price gouge its users so take this for free.

Select text on any web page, right-click, choose **Read aloud**, and it reads the text in a natural voice.

- The voice is Phonon 31M, and it runs entirely on your own computer.
- No account or internet is needed, and nothing you select is sent anywhere.
- It works on Windows and macOS in Google Chrome 121+ and Chrome-based browsers (Edge, Brave), and in Firefox 128+.

## Install in Chrome, Edge or Brave (about 2 minutes)

1. If someone sent you `phonomenal-free-tts-<version>.zip`, unzip it to a permanent place such as Documents. Chrome runs the extension from that folder, so don't move or delete it.
2. Type `chrome://extensions` in the address bar (`edge://extensions` in Edge) and press Enter.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and choose the `extension` folder, the one that contains `manifest.json`.
5. A welcome page opens. Click **Read this to me**.
6. Pin the icon: click the puzzle-piece icon at the top-right, then click the pin next to **Phonomenal Free TTS**.

## Install in Firefox

Until it is signed by Mozilla, Firefox only loads it **until Firefox is closed**.

1. Type `about:debugging#/runtime/this-firefox` in the address bar and press Enter.
2. Click **Load Temporary Add-on…** and choose `extension/manifest.json`.

For a permanent install, the add-on needs signing on addons.mozilla.org. An "unlisted" signing is free and keeps it private. You then get a `.xpi` file that friends install with a double-click.

In Firefox the voice uses one processor core instead of three. It still reads about three times faster than it speaks.

## Use it

| To… | Do this |
|---|---|
| Read something | Select text, right-click it, choose **Read aloud** |
| Stop | Click the red **Stop** at the bottom-right of the page, press **Esc**, or right-click and choose **Stop reading** |
| Pause | **Pause** on the same bar, then **Resume** |
| Use the keyboard | Select text, then press **Alt+Shift+R** (Mac: **Option+Shift+R**). Press it again to stop |
| Change voice or speed | Click the Phonomenal icon. Pick a voice (6 men, 5 women) and Slower, Normal or Faster, then click **Hear this voice** |

## Good to know

- **First sound.** The first read after starting the browser takes about a third of a second while the voice loads. After that, speech starts almost instantly.
- **Browser pages.** The browser's own pages and the add-on stores don't allow the on-page buttons. Reading still works there; stop it from the icon or the right-click menu.
- **Backup voice.** If the natural voice ever fails to start, it uses your computer's built-in voice instead.

## For whoever maintains it

- **Rebuild the large files** (runtime, model, voices, icons): `python scripts/assemble.py`
- **Make a shareable zip** (`dist/phonomenal-free-tts-<version>.zip`): `python scripts/package.py`
- **Tests** run from `browser-bench/` after `npm install`:
  - **Chrome.** Run `npx playwright install chromium` once, then `node e2e.mjs`. For the on-page bar, add `--ext <copy with host_permissions>`. For the backup voice, add `--fallback --ext <copy with a corrupted model>`.
  - **Firefox.** Uses the installed Firefox: `node e2e-firefox.mjs --ext <copy with host_permissions and the test-bridge.js content script>`.
  - **Screenshots** of every screen: `node shots.mjs`
- **How it works**
  - Chrome: the service worker sends text to an offscreen document that runs `player.js`.
  - Firefox: the background event page runs `player.js` itself. While reading, the on-page bar pings every 10 s so Firefox doesn't unload it mid-sentence.
- **Licences.** The Phonon model and voices are Apache-2.0 (Gradium). The phonon-tts runtime is MIT OR Apache-2.0. See `extension/model/LICENSE` and `extension/vendor/phonon-tts/`.
