---
description: "Prevent terminal command failures from shell metacharacter interpretation, output capture issues, and hanging commands"
applyTo: "**"
lastReviewed: 2026-07-07
---

# Terminal Command Safety

**Always-on rationale**: terminal commands fire from any task regardless of file context (build, test, git, deployment, exploration). Safety rules — especially the Backtick Hazard — must apply before every `run_in_terminal` call. A pattern-scoped glob would silence the protection in the cases most likely to ship destructive failures.

## Backtick Hazard (Critical)

Backticks break in ALL shells (bash=command substitution, PowerShell=escape char). NEVER place raw backticks inside double-quoted terminal arguments.

| Content contains | Action |
|---|---|
| Backticks | Always use temp file |
| Multi-line text | Prefer temp file |
| Both quote types | Use temp file |
| Dollar signs (`$`) | Single-quoted heredoc or temp file |
| Plain text only | Inline is safe |

Rules: `gh` → `--body-file`, `git commit` → `-F <file>`, any CLI → file-based input over inline.

**Temp file location matters**: place temp files **outside the working tree** (`$env:TEMP\<slug>.txt` on Windows, `/tmp/<slug>.txt` on Unix) OR add the pattern to `.gitignore` before staging. Otherwise `git add -A` will stage and commit the message file itself. S360 hit this twice in 2026-05 (commits `26631b4` then caught mid-flight on the next leak via Tenet X self-review).

Preferred PowerShell template for multi-line commit messages:

```pwsh
$m = Join-Path $env:TEMP "<slug>.txt"
Set-Content -Path $m -Value $msg -NoNewline
git commit -F $m
Remove-Item $m
```

Filesystem isolation prevents the leak by construction.

## Output Capture Failures

Terminal output can be silently lost or truncated.

1. Redirect to file, then read: `cmd 2>&1 | Out-File $env:TEMP\out.txt`
2. Pipe pagers through `Out-String`
3. Sentinel: `; echo "EXIT_CODE:$LASTEXITCODE"`
4. Limit volume: `Select-Object -First`, `-Tail`, `Format-Table`
5. Avoid alt-buffer programs (`less`, `vim`, `man`) — use non-interactive equivalents
6. If empty: retry with `get_terminal_output`, then redirect to file, then check stderr

## Terminal Hanging

1. `mode=async` for commands >15s (servers, builds, test suites). VS Code 1.121+ also auto-promotes sync→background after a configurable idle-silence period via `run_in_terminal`; this rule remains correct as agent intent and is required on older builds.
2. Never run interactive commands — pre-answer with flags (`--yes`, `--no-edit`)
3. Set network timeouts (`--max-time`, `--prefer-offline`)
4. Avoid heredoc blocks (desync terminal parser)
5. One command at a time — no chaining unrelated commands
6. Kill stuck: `send_to_terminal` with Ctrl+C, or start fresh terminal

## VS Code platform changes (1.117–1.127) — reduce manual capture

Recent VS Code agentic-execution improvements reduce the need for some manual patterns above. Treat as additive shortcuts; the file-redirect fallback above remains the safe default when full unfiltered output matters.

| Surface | Behavior change | When the manual pattern still wins |
|---|---|---|
| 1.117 | Terminal output auto-included after `send_to_terminal`; async-completion notifications fire automatically | When you need exact byte-for-byte output for diagnostics |
| 1.118 | Agentic execution sub-tool pre-filters terminal output (drops noise) | When parsing exact error strings, full test results, encoding-sensitive output |
| 1.120–1.121 | `chat.tools.compressOutput.enabled` post-processes long output (diffs, test runners, builds); chat-agent background terminals auto-dispose after one-shot async commands | When you need raw lockfile diffs, full npm install logs, or output the compressor filters strip |
| 1.127 | macOS/Linux terminal commands sandboxed by default | On mac/Linux, agent-invoked terminal commands run with network blocked + FS restricted; only elevation prompts for approval. Reduces the "approve every command" fatigue that Backtick Hazard mitigates on Windows. **On Windows, no change — all existing safety rules still apply.** |

## Falsifier — Backtick Hazard

The Backtick Hazard rule is load-bearing because the underlying defect is unfixed in VS Code through 1.128 ([microsoft/vscode#295620](https://github.com/microsoft/vscode/issues/295620), open, milestone *On Deck*). Re-evaluate when #295620 closes; until then, the temp-file pattern is mandatory.
