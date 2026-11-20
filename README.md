<img src="assets/icon.svg" width="64" height="64" alt="">

# Couch-emu

Turn any host browser into a living-room game console on your TV, and pair smartphones over Wi-Fi as low-latency wireless game controllers.

## Features

- **Main Browser TV Host (`/`)**:
  - **Retro Console Emulator (WASM via Nostalgist / RetroArch)**: Drag-and-drop `.nes`, `.sfc`, `.smc`, `.gba`, `.gb`, `.gbc`, `.md`, `.gen`, `.z64`, `.n64`, and `.pce` ROMs with auto-core detection, save/load states, CRT scanlines toggle, pause/restart, and automatic phone controller layout switching.
  - **60-Game Arcade Vault**: 60 built-in 1–4P party games (no ROMs needed) with phones, CPU bots, keyboard P1 fallback and phone rumble. Each cartridge boots with a title card and a 3-2-1-GO countdown, renders at native resolution up to 1080p with an optional bloom glow, and plays its own generated synthwave soundtrack. Favorites, recents, Party Roulette, a 5-game mix, and an attract mode that tours the library when the console sits idle.
  - **Custom Web Game Adapter**: Load external web game URLs or local `.html` games (includes a built-in `/sdk-sample.html` demo). Automatically bridges `navigator.getGamepads()` and structured `postMessage` SDK events (`COUCH_EMU_INPUT`, `COUCH_EMU_PLAYERS`, `COUCH_EMU_SET_LAYOUT`, `COUCH_EMU_RUMBLE`).
  - **Optional WebRTC `/tv` Receiver (`/tv/:roomCode`)**: Plug your host laptop into the TV via HDMI, **or** open `/tv` on a separate TV browser and toggle **Stream to `/tv`** to cast the game canvas and Web Audio over WebRTC.
- **Phone Wireless Controllers (`/play/:roomCode`)**:
  - **QR Code + 4-Letter Room Code Pairing**: Automatically discovers your host computer's LAN IP so phones on the same Wi-Fi connect immediately by scanning the QR code.
  - **Drop-Proof Player Ports**: A phone that locks its screen or loses Wi-Fi keeps its P1–P4 port for 45 seconds and snaps back in automatically; the host shows join, drop and reconnect toasts. A server heartbeat clears dead connections, and per-player latency appears in the pairing drawer.
  - **Add to Home Screen**: Ships a web manifest, so a phone can install the controller as a fullscreen, landscape app.
  - **Console-Matched Multi-Touch Gamepads**: `NES`, `SNES`, `GBA`, `Sega Genesis (6-Button)`, `Nintendo 64`, and `Dual-Stick Pro` layouts with 8-way diagonal-rolling D-pads, analog thumbsticks, haptics (`navigator.vibrate`), rumble from host games, fullscreen landscape mode, and Wake Lock.
  - **Low-Latency Transport**: Connects immediately via WebSocket and automatically upgrades to an unordered WebRTC `DataChannel` (`P2P`) when available.

## Architecture

| Workspace | What lives there |
| --- | --- |
| `shared/` | Wire protocol types, input sanitizing, console profiles. Built to `shared/dist` automatically before `dev`, `test`, `typecheck` and `start`. |
| `server/` | Express + `ws` room server: rooms, player ports with reconnect grace, ws heartbeat, WebRTC signaling relay. |
| `client/` | React host console (`/`), phone controller (`/play/:code`) and TV receiver (`/tv/:code`). Each route is code-split, so phones never download the game engines or emulator. |

Games live in `client/src/games/engines/*` and share `client/src/games/sharedEngine.ts` (VFX, audio, HUD, backdrop). The engines' `step()` runs at a fixed 60 Hz in game units (960×540); the host scales that to the display's pixel density.

## Quick Start

```bash
npm install
npm run dev
```

- Open **`http://localhost:5173`** on your host computer (plugged into your TV via HDMI, or streaming to `/tv`).
- Scan the QR code on your phone (on the same Wi-Fi) to open **`http://<YOUR-LAN-IP>:5173/play/<ROOM_CODE>`**.
- Or click **Test** in the pairing sidebar to open a phone controller in another browser tab on the same machine.

## Production Build (use this for real play sessions)

```bash
npm run play          # = npm run build && NODE_ENV=production npm start
```

The dev server (`npm run dev`) runs React in development mode, which makes the
console UI noticeably heavier. For game nights, use the production build and
open `http://<YOUR-LAN-IP>:3001` on the TV computer.

Runs the unified Express + WebSocket + static client server on port `3001` (configurable via `PORT`).

## Tests & Typecheck

```bash
npm run typecheck
npm test
```
