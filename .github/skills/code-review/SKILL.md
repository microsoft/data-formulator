---
name: "code-review"
description: "Systematic code review for correctness, security, and growth — not just style enforcement"
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition omits the two Supervisor-specific checklist items ("every export called by production", "filter-style guards have test data") that reference Supervisor-only mutation-testing skill. Heirs don't ship mutation-testing. Audited 2026-05-31. -->

# Code Review Skill

> Good reviews catch bugs. Great reviews teach the author something.

## Review Priority (What Matters Most)

1. **Correctness** — Does it do what it's supposed to?
2. **Security** — Can it be exploited?
3. **Maintainability** — Will the next person understand this?
4. **Performance** — Will it scale?
5. **Style** — Is it consistent? (ideally enforced by linters, not humans)

## 3-Pass Review

| Pass | Focus | What You're Looking For | Time |
| ---- | ----- | ----------------------- | ---- |
| 1. Orientation | Big picture | Does the approach make sense? Is the scope right? Over-engineered? | 2-3 min |
| 2. Logic | Deep read | Edge cases, null handling, error paths, concurrency, off-by-one | 10-15 min |
| 3. Polish | Surface | Naming, duplication, test coverage, docs | 3-5 min |

**Pass 1 shortcut**: Read the PR description and test names first. They reveal intent faster than code.

## Comment Prefixes

| Prefix | Meaning | Author Response |
| ------ | ------- | --------------- |
| `[blocking]` | Must fix before merge | Fix it |
| `[suggestion]` | Better approach exists | Consider it, explain if declining |
| `[question]` | I don't understand | Clarify (in code, not just in reply) |
| `[nit]` | Trivial style issue | Fix if easy, skip if not |
| `[praise]` | This is well done | Appreciate it |

### Good vs Bad Comment Examples

| Bad | Why | Good |
| --- | --- | ---- |
| "This is confusing" | Vague, unhelpful | "[suggestion] This nested ternary is hard to follow. Consider extracting to a named function like `isEligibleForDiscount()`." |
| "Fix this" | No context | "[blocking] This accepts user input without sanitization. Use `escapeHtml()` before rendering." |
| "Why?" | Sounds hostile | "[question] What's the motivation for the custom sort here vs `Array.sort()`? Is there a performance concern?" |
| "LGTM" (on 500-line PR) | Rubber stamp | "Pass 1: Approach looks right. Pass 2 comments below. Pass 3: naming is clean." |

## Review Checklist

### Security

- [ ] No secrets, tokens, or API keys in code
- [ ] User input validated/sanitized before use
- [ ] Auth checks on protected endpoints
- [ ] No SQL/command injection vectors
- [ ] Sensitive data not logged

### Logic

- [ ] Edge cases handled (empty input, null, boundary values)
- [ ] Error paths return meaningful messages
- [ ] Async operations have timeout/cancellation
- [ ] State changes are atomic (no partial updates)
- [ ] All new branches have test coverage

### Quality

- [ ] Tests cover the *changed behavior*, not just the changed lines
- [ ] No debug code (console.log, TODO-hacks)
- [ ] Public API changes documented
- [ ] Backward compatibility considered

### Architecture

- [ ] Change is in the right layer (not business logic in the controller)
- [ ] New dependencies justified
- [ ] No unnecessary coupling introduced

## Anti-Patterns

| Anti-Pattern | What Happens | Instead |
| ------------ | ------------ | ------- |
| Rubber-stamp | Bugs ship | Actually read Pass 1-3 |
| Bikeshedding | Hours on naming, ignore logic bugs | Spend 80% on Pass 2 |
| Gatekeeping | Reviewees dread PRs | Teach, don't block |
| Week-long queue | PRs go stale, conflicts pile up | Review within 4 hours, merge within 24 |
| Style wars | Team friction | Automate style (ESLint, Prettier, etc.) |
| Everything-is-blocking | Author overwhelmed | Use prefix system honestly |

## Mission-Critical Review (NASA Standards)

For safety-critical projects, apply NASA/JPL Power of 10 rules during review:

### Blocking Violations (Must Fix)

| Rule | Check For | Detection |
| ---- | --------- | --------- |
| **R1** | Recursive function without `maxDepth` parameter | `grep -rn "function.*\(" \| xargs grep -l "walk\|traverse\|recurse"` |
| **R2** | `while` loop without iteration counter | Manual review of all `while` statements |
| **R3** | Unbounded array growth | `push()` in loops without size checks |

### High Priority (Strong Recommendation)

| Rule | Check For | Detection |
| ---- | --------- | --------- |
| **R4** | Function > 60 lines | Line count per function |
| **R5** | Missing entry assertions | Public functions without precondition checks |
| **R8** | Nesting > 4 levels | Visual inspection of indentation |

### Medium Priority (Consider)

| Rule | Check For | Detection |
| ---- | --------- | --------- |
| **R6** | Variable declared far from use | Manual review |
| **R7** | Unchecked return values | `grep` for ignored returns |
| **R9** | Deep property access without `?.` | `obj.prop.prop.prop` chains |
| **R10** | Compiler warnings | Build output |

**Trigger**: User mentions "mission-critical", "NASA standards", "high reliability", or "safety-critical"

## Review Timing

| PR Size | Expected Review Time | If Larger |
| ------- | -------------------- | --------- |
| < 100 lines | < 30 min | — |
| 100-400 lines | 30-60 min | Ideal size |
| 400+ lines | 60+ min | Ask author to split |
| 1000+ lines | Don't | Refuse; request breakdown |

---

## Extension Audit Methodology (VS Code Extensions)

**When**: Before release, after major refactoring, or on quality concerns

**Scope**: Multi-dimensional code quality analysis beyond standard code review

### 5-Dimension Audit Framework

| Dimension | Focus | Tools/Methods | Output |
| --------- | ----- | ------------- | ------ |
| **Debug & Logging** | Console statements, debug code | `grep -r "console\\.log\|console\\.debug"` | Categorize: legitimate vs removable |
| **Dead Code** | Unused imports, orphaned files, broken refs | TypeScript compilation + manual scan | List dead commands, UI, dependencies |
| **Performance** | Blocking I/O, sync operations, bottlenecks | `grep -r "Sync\(" src/`, profiling | Async refactoring candidates |
| **Menu Validation** | All commands/buttons work | Manual testing + error logs | Broken commands, missing handlers |
| **Dependencies** | Unused packages, leftover references | package.json vs import analysis | Removable dependencies |

### Audit Report Template

```markdown
## Executive Summary
- Console statements: X remaining (Y legitimate, Z removable)
- Dead code: [commands/UI/dependencies list]
- Performance: [blocking operations count]
- Menu validation: [working/broken ratio]

## Recommendations
1. [Category]: [Issue] → [Action] (Priority: Critical/High/Medium)
2. [Category]: [Issue] → [Action] (Priority: Critical/High/Medium)
```

### Console Statement Categorization

| Category | Keep? | Examples |
| -------- | ----- | -------- |
| **Enterprise compliance** | ✅ | Audit logs, security events, GDPR actions |
| **User feedback** | ✅ | TTS status, long-running ops, critical errors |
| **Debug noise** | ❌ | Setup verbosity, migration logs, info messages |
| **Development artifacts** | ❌ | "Entering function X", temporary debugging |

### Performance Red Flags

- **Synchronous file I/O** in UI thread: `fs.readFileSync`, `fs.existsSync`, `fs.readdirSync`
  - **Fix**: Convert to `fs-extra` async: `await fs.readFile`, `await fs.pathExists`, `await fs.readdir`
- **Blocking operations** in activation: Heavy computation before extension ready
  - **Fix**: Defer to background, show loading state, or lazy-load
- **Serial operations** that could be parallel: Sequential awaits for independent tasks
  - **Fix**: `Promise.all([op1(), op2(), op3()])`

### Dead Code Detection Pattern

1. **Scan command registrations**: `vscode.commands.registerCommand('command.id', ...)`
2. **Scan UI references**: Search HTML/views for command IDs
3. **Cross-check**: Commands in UI but not registered = broken; registered but unused = dead
4. **Verify disposables**: Removed commands should have disposable cleanup too

### Post-Audit Verification

- [ ] TypeScript compiles: `npm run compile` → exit 0
- [ ] No orphaned imports: All imports resolve
- [ ] Version aligned: package.json, CHANGELOG, copilot-instructions match
- [ ] Smoke test: Extension activates, 3 random commands work

**Pattern applies to**: VS Code extensions, Electron apps, Node.js services with UI

## Would Revise If

Revise if reviews repeatedly miss security or correctness defects that adversarial review (`deep-review` skill) catches on the same PR, or if the 3-pass model produces consistent false-positive `[blocking]` comments that authors reasonably decline.
