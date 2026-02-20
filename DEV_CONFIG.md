# Development Configuration Guide

## Token Cost Optimization

The app now uses **environment-based model selection** to reduce costs during development.

### Configuration

Edit `/Users/williambryant/cue-line/lib/config.ts`:

```typescript
export const DEV_MODE = true;  // Set to false for production
```

### Development Mode (DEV_MODE = true)
- **Model**: Claude Haiku (~80% cost reduction)
- **Coaching Questions**: Skipped (uses generic fallback)
- **API Logging**: Enabled
- **Cost**: ~$0.001 per script parse vs $0.20+ with Sonnet

### Production Mode (DEV_MODE = false)
- **Model**: Claude Sonnet (higher quality)
- **Coaching Questions**: Full AI-generated
- **API Logging**: Disabled
- **Cost**: Higher, but better quality for end users

## Development Workflow

1. **During feature development**: Keep `DEV_MODE = true`
2. **Before releasing**: Change to `DEV_MODE = false` to test with full quality
3. **API calls now include logging**: Check console for model being used

## Cost Comparison

For parsing a 2,000-line script:

| Mode | Model | Cost | Speed |
|------|-------|------|-------|
| Development | Haiku | ~$0.01-0.02 | ~5s |
| Production | Sonnet | ~$0.15-0.25 | ~10s |

**Savings: ~80-90% during development**

## What Still Works in Dev Mode

- ✅ Script parsing (structure, characters, scenes, lines)
- ✅ Line evaluation (accuracy scoring)
- ✅ Hints (first few words, half line, full line)
- ✅ All UI/UX features
- ⚠️ Coaching questions (returns generic fallback)

## Switching Back to Production

When ready to ship or do final QA:

```typescript
// lib/config.ts
export const DEV_MODE = false;  // ← Change this
```

Then test with `npm start` to ensure Sonnet model is being used.

## Monitoring

In development mode, the console will log all API calls:
```
[Claude API] Model: claude-haiku-4-5-20251001, Tokens: 32000
[Claude API] Model: claude-haiku-4-5-20251001, Tokens: 150
```

This helps you see what's happening behind the scenes.
