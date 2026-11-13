<div align="center">

<img src="https://github.com/wisewavelabs.png" alt="WiseWave Labs logo" width="88" height="88" />

# WiseWave

**One more song, then we'll sleep.**


[![Latest release](https://img.shields.io/github/v/release/Fristonn/WiseWave?include_prereleases&style=flat-square&logo=github&label=release&color=8b5cf6)](https://github.com/Fristonn/WiseWave/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Fristonn/WiseWave/total?style=flat-square&logo=github&label=downloads&color=2563eb)](https://github.com/Fristonn/WiseWave/releases)
![Windows](resources/assets/windows-platform.svg)

</div>

## Technology

i built the windows desktop app with **mygo**, using **go** for its native shell and playback runtime. the interface is made with **react** and **typescript**, shaping the player, library, lyrics, and settings.

## Download

**[Get WiseWave from GitHub Releases](https://github.com/Fristonn/WiseWave/releases)**

Release packages and changelogs are published here.

## Support & Community

[![Support Server](https://img.shields.io/badge/Discord-Support%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/xNYnxjE6hS)

## Independent Development & Technical Notice

WiseWave is an independently developed Windows desktop music player. This repository contains the desktop source code, app releases, and project documentation.

## Third Party Copyright Notice

- **No affiliation.** WiseWave Labs is not affiliated with, endorsed by, or sponsored by Google, YouTube, YouTube Music, Spotify, Apple Music, Last.fm, or any other music or technology provider.
- **No ownership claim.** Music, cover artwork, metadata, trademarks, and other third-party materials remain the property of their respective rights holders.
- **No media distribution through this repository.** This repository provides application source and releases, not a catalog of copyrighted audio or video files.

For copyright concerns or takedown requests, please contact [Fristonn](https://github.com/Fristonn).

## Repository

This repository contains the WiseWave Windows desktop app source, releases, and documentation.

## License

WiseWave is distributed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

## Build from source

The Windows desktop app uses Go, MyGo, React, and TypeScript.

Requirements: Go 1.27.3, Node.js 22, npm, and NSIS for the Windows installer.

```powershell
npm ci
npx mygo dev
```

To build the Windows app and installer for Intel/AMD and ARM:

```powershell
npx mygo build -platform windows/amd64,windows/arm64
```

Build artifacts are written under `dist/windows-amd64/` and `dist/windows-arm64/`.

## Thank you to the open source community!!!

Lyrics in WiseWave are possible thanks to the open source providers who make their work available. We’re grateful for their contributions; you can find their credits and licenses in the app under **About / Licenses**.
