---
name: interaction
description: Ask the user a structured question and pause for the reply.
always_on: false
tools: []
actions:
  - ask_user
---

# Interaction

Use `ask_user` whenever the user must reply: a clarification needed before
acting, a choice, or a brief statement paired with clickable follow-ups. Plain
text ends the run; `ask_user` pauses it and preserves the turn context.

Provide one to three actionable questions. Use `single_choice` with at most
three likely options or `free_text` for an open answer. Put reasoning and
context in normal response text, not in a question item. Set `required: true`
when progress depends on the answer and `false` only for optional follow-ups.