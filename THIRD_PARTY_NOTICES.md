# Third-party notices

vibeediting uses these open-source components. Each keeps its own license.

## Bundled in the package (and in the Claude app extension)

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

- **FFmpeg** runs as a separate program. vibeediting uses the FFmpeg already on the computer when it has caption support. Otherwise it downloads FFmpeg 6.1.1 static builds (with libass and x264, licensed **GPL-3.0-or-later**) from the `eugeneware/ffmpeg-static` GitHub release `b6.1.1` into `~/.vibeediting/bin`, checks their SHA-256 checksums and writes a README with this notice next to them. vibeediting does not link to FFmpeg and does not change it. FFmpeg source code: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz . Build scripts: https://github.com/eugeneware/ffmpeg-static . FFmpeg is a trademark of Fabrice Bellard.
- **Node.js** (MIT) is downloaded by the installer from nodejs.org only when the computer has no Node.js 22.12 or newer.
- **Whisper models** (ggml format, MIT) are downloaded from Hugging Face (`ggerganov/whisper.cpp`) on first use.
- **Google Chrome / Microsoft Edge** are used if installed, for custom animations.
- **Pexels and Pixabay** clips are downloaded with the user's own API key under the Pexels License and the Pixabay Content License. Credits are saved to `broll/credits.json`.
