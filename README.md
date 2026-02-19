# Cue Line

An iOS/Android app for actors to memorize lines. Upload a script, pick your character, and practice your lines hands-free using speech recognition — Claude listens, evaluates your delivery, and gives feedback.

## How it works

1. **Upload** a PDF or TXT script
2. Claude parses it into scenes and identifies each character's lines with their cue lines
3. **Practice** — the app reads your cue line aloud, you speak your line, Claude evaluates accuracy and gives feedback or hints

## Tech stack

- [Expo](https://expo.dev) (SDK 54) + Expo Router (file-based navigation)
- React Native / TypeScript
- `expo-speech` for text-to-speech
- `expo-speech-recognition` for speech-to-text (requires a dev build — not Expo Go)
- AsyncStorage for local persistence
- [Claude API](https://anthropic.com) for script parsing, line evaluation, and hints

## Getting started

```bash
npm install
npm start
```

> Speech recognition requires a development build. Use `npx expo start` for UI-only work in Expo Go.

### Building to a device

This project uses [EAS Build](https://docs.expo.dev/build/introduction/) (no local Xcode required):

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform ios
```

## Configuration

Add your Anthropic API key in the app's **Settings** screen. It's stored locally in AsyncStorage and never committed to version control.

## Running tests

```bash
npm test
```

## Project structure

```
app/
  (tabs)/         # Home + Settings tabs
  upload.tsx      # Script upload modal
  script/[id]/
    index.tsx     # Scene list for a script
    practice.tsx  # Speech practice loop
lib/
  claude.ts       # All Claude API calls
  storage.ts      # AsyncStorage CRUD
types/index.ts    # Shared TypeScript types
constants/theme.ts
```
