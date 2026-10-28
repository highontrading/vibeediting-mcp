# Third-party notices

vibeediting uses these open-source components. Each keeps its own license.

## Bundled in the package

| Component | License | Notes |
|---|---|---|
| Poppins fonts | SIL Open Font License 1.1 | `assets/fonts/OFL-poppins.txt` |
| Mukta fonts | SIL Open Font License 1.1 | `assets/fonts/OFL-mukta.txt` |
| Noto Sans Devanagari | SIL Open Font License 1.1 | `assets/fonts/OFL-notosansdevanagari.txt` |
| Anton | SIL Open Font License 1.1 | `assets/fonts/OFL-anton.txt` |
| Bebas Neue | SIL Open Font License 1.1 | `assets/fonts/OFL-bebasneue.txt` |

## Installed as npm dependencies

| Component | License |
|---|---|
| @modelcontextprotocol/server | Apache-2.0 |
| zod | MIT |
| playwright-core | Apache-2.0 |
| @fugood/node-whisper-* (whisper.cpp / ggml) | MIT |

## Used but not distributed

- **FFmpeg** is installed by the user (Homebrew, winget). vibeediting runs it as a separate program and does not ship it.
- **Whisper models** (ggml format, MIT) are downloaded from Hugging Face (`ggerganov/whisper.cpp`) on first use.
- **Google Chrome / Microsoft Edge** are used if installed, for custom animations.
- **Pexels and Pixabay** clips are downloaded with the user's own API key under the Pexels License and the Pixabay Content License. Credits are saved to `broll/credits.json`.
