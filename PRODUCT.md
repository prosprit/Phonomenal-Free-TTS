# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- Students and studiers listening to textbooks, PDFs and articles while they study.
- People who rely on listening because reading is hard: dyslexia, low vision, reading fatigue.
- Multilingual readers who meet pages in several languages, or are learning one.
- Anyone who prefers listening to reading.

The job in every case: hear the text in front of them, in a natural voice, without setup, accounts or cost.

## Product Purpose
Phonomenal Free TTS is a Chrome and Firefox extension that reads selected text, whole pages and PDFs aloud with a natural neural voice. Success is a person selecting text, choosing Read aloud, and hearing it within about a second, then never needing the settings again unless they want a different voice.

## Positioning
The voice runs entirely on the user's device (Phonon 40M multilingual, WebAssembly). Nothing is sent to a server, it works offline, and it is free. Language is detected from the text, and each language keeps its own chosen voice.

## Operating Context
- Started from the right-click menu ("Read aloud"), the keyboard shortcut (Alt+Shift+R by default) or the toolbar popup.
- Keeps reading down the page with highlighting; PDFs open in the extension's own reader with page highlighting.
- The toolbar popup is a small settings surface opened briefly and often: pick a language's voice, set the speed, hear a sample. Chrome caps it at 600 px tall.
- Languages: English, Spanish, French, German, Portuguese. 37 bundled voices.

## Capabilities and Constraints
- Manifest V3; Chrome 121+, Firefox 128+.
- Model and voices ship inside the extension (about 76 MB package); no network after install.
- Model license is CC BY-NC 4.0, so the extension stays free and non-commercial.
- Settings sync through browser storage: language mode (detect or fixed), one voice per language, speed.
- Performance budget: popup and reader UI add no web fonts, images or animation libraries; system fonts only.

## Brand Commitments
- Name: Phonomenal (full: Phonomenal Free TTS). Existing speaker icon.
- Promise in plain words: free, private, offline, natural voice.

## Evidence on Hand
- Measured voice pitch for every voice: bench/logs/voice_pitch_050.txt.
- No testimonials, user counts or reviews exist; do not invent them.

## Product Principles
1. Reading starts from the text itself; settings are optional and stay out of the way.
2. Private and offline is the product, not a feature: never add anything that phones home.
3. Plain language and calm layouts, because many users find reading hard.
4. Cheap to run: every UI addition must cost close to nothing on old laptops.

## Accessibility & Inclusion
- WCAG 2.2 AA baseline: contrast, full keyboard use, screen reader labels.
- Bigger targets and text than the minimum: about 44 px click targets where space allows, nothing smaller than 15 px for primary labels.
- Dyslexia-friendly reading: generous spacing, short lines, no dense text blocks, especially in the PDF reader.
