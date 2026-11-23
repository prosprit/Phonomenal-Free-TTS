| Model | Params | MB | First audio 1-core (ms) | Speed 1-core | Speed 4-core | RAM 1-core | WER % (spoken ref) | UTMOS | Listener ★ (n) | Failed inputs |
|---|---|---|---|---|---|---|---|---|---|---|
| Kokoro-82M v1.0 (int8 ONNX) | 82M | 88 | 4082 | 1.2x | 1.3x | 502 MB | 0.97 | 4.473 | 3.75 (4) | 0 |
| Phonon 31M en (q8) | 31M (+10M codec) | 65 | 1794 | 3.0x | 7.4x | 268 MB | 0.97 | 4.405 | 4.5 (4) | 0 |
| kale-tts-1-nano (int8) | 7.5M | 15 | 165 | 29.1x | 58.5x | 365 MB | 0.49 | 4.505 | 3.5 (4) | 0 |
| tiny-voca F2 (fp32 ONNX) | 4.5M | 21 | 137 | 32.6x | 64.4x | 364 MB | 0.32 | 4.415 | 1.0 (4) | 0 |
| Paradee-8M v1.3 (int8) | 7.9M | 9 | 286 | 19.5x | 38.9x | 718 MB | 1.62 | 4.351 | 3.5 (4) | 0 |
| Klein-TTS X1.5 Pro | 13.1M | 53 | 921 | 5.9x | 12.9x | 628 MB | 0.97 | 4.436 | 3.5 (4) | 0 |
| Supertonic 3 | ~99M | 385 | 3251 | 1.7x | 3.4x | 529 MB | 1.94 | 4.46 | 3.5 (4) | 0 |
| KittenTTS 2 mini | 82M | 91 | – | – | 1.5x | – | 1.46 | 4.464 | 4.0 (3) | 0 |
| nano-edge-tts-standalone v2.1 | 3.3M | 30 | – | – | 42.1x | – | 1.46 | 4.447 | 2.75 (4) | 0 |
| PiVo-1.4M (16 kHz) | 1.4M | 9 | – | – | 4.8x | – | 12.62 | 4.314 | 1.33 (3) | 4 |
| Windows built-in voice (baseline) | - | 0 | – | – | – | – | – | – | – (0) | – |
