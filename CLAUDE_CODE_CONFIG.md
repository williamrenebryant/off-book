# Claude Code Configuration for Cue Line

This project has cost-optimization settings for Claude Code (the CLI tool).

## Current Setup

**Development Mode** (Default):
- Model: **Haiku** (faster, cheaper)
- Config: `.claude/settings.json`
- Use for: Feature development, bug fixes, refactoring
- Cost savings: ~80% vs Sonnet

## Switching Modes

### Development (Haiku) - Default
No action needed! Claude Code will use Haiku by default.

### Production/Final Testing (Sonnet)
To switch Claude Code to Sonnet for final testing:

**Option 1: Temporary (single command)**
```bash
# Claude Code will use Sonnet for the next command only
claude --model sonnet [your command]
```

**Option 2: Project-wide (persistent)**
Edit `.claude/settings.json`:
```json
{
  "model": "sonnet",
  "description": "Final testing with full quality"
}
```

**Option 3: Global (all projects)**
Edit `~/.claude/settings.json`:
```json
{
  "model": "sonnet"
}
```

Then switch back to `"haiku"` when done.

## Cost Impact

| Task | Model | Time | Cost |
|------|-------|------|------|
| Feature implementation | Haiku | ~2 min | ~$0.02 |
| Large refactor | Haiku | ~5 min | ~$0.05 |
| Final QA review | Sonnet | ~5 min | ~$0.25 |

## Combined Savings

With **both** configurations:
- App API calls: Haiku (dev mode) = `lib/config.ts`
- Claude Code work: Haiku (dev mode) = `.claude/settings.json`
- **Total savings: ~90% during development**

When switching to production:
- App: Change `lib/config.ts` → `DEV_MODE = false`
- Claude Code: Change `.claude/settings.json` → `"model": "sonnet"`

---

**Bottom line**: You're already saving on Claude Code costs! Just remember to check the model before large AI-intensive tasks.
