# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Cue Line is an iOS/Android app for actors to memorize lines. It parses scripts (PDF/TXT), identifies character lines, and runs a speech-based practice loop: show cue line → actor speaks → Claude evaluates accuracy → provide feedback/hints.

## Commands

```bash
# Start the dev server (Expo Go compatible parts only)
npm start

# Run on iOS simulator (requires full Xcode.app installed)
npm run ios

# TypeScript check
npx tsc --noEmit

# Install a new Expo-compatible package
npx expo install <package-name>
```

## Building to a physical device

This project uses EAS Build (cloud builds, no local Xcode needed):

```bash
# One-time: install EAS CLI and log in
npm install -g eas-cli
eas login
eas build:configure   # generates eas.json

# Build a dev client (installs on your phone via link)
eas build --profile development --platform ios

# Build for TestFlight
eas build --profile preview --platform ios
```

## Architecture

**Navigation**: Expo Router (file-based). Routes:
- `(tabs)/index` — home screen, lists saved scripts
- `(tabs)/settings` — API key and preferences
- `upload` — modal for picking + parsing a script
- `script/[id]/index` — script overview + scene list
- `script/[id]/practice` — core practice mode (speech loop)

**Key files**:
- `lib/claude.ts` — all Anthropic API calls (script parsing, line evaluation, hints, coaching questions)
- `lib/storage.ts` — AsyncStorage CRUD for scripts, progress, settings
- `types/index.ts` — shared TypeScript types (Script, Scene, Line, FeedbackResult, etc.)
- `constants/theme.ts` — colors, spacing, font sizes

**Data flow**:
1. Upload screen picks PDF → reads as base64 → sends to Claude (haiku) to extract text → sends to Claude (sonnet) to parse into structured JSON (characters, scenes, lines with cue lines)
2. Script stored in AsyncStorage via `lib/storage.ts`
3. Practice mode: `expo-speech-recognition` captures speech → sends spoken text + correct line to Claude for evaluation → `FeedbackResult` displayed

**Color palette**: Soft warm neutrals — background `#F5EFE6`, accent `#B07D62`, text `#2C2416`

## AI model usage

- Script parsing: `claude-sonnet-4-6` (high quality, complex structure extraction)
- PDF text extraction: `claude-haiku-4-5-20251001` (fast, cheap)
- Line evaluation, hints, coaching: `claude-sonnet-4-6`

## Speech

- TTS (reading cue lines aloud): `expo-speech`
- STT (capturing actor's line): `expo-speech-recognition` — requires a development build (not Expo Go)
- Microphone + speech recognition permissions are declared in `app.json` under `ios.infoPlist`

## API key storage

The Anthropic API key is stored in AsyncStorage (settings screen). It is never committed to version control. The key is loaded in each screen that calls Claude via `getSettings()`.
