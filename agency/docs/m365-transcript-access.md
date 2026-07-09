# M365 And Transcript Access

M365 tools are powerful enough to read sensitive work content. Use them only
when the task explicitly needs that context.

## Safe Pattern

1. Use calendar metadata to identify the exact meeting.
2. Ask for approval before transcript or AI insight retrieval.
3. Fetch only the named meeting's transcript or AI insight.
4. Summarize only the requested meeting.
5. Do not fetch related mail, Teams chats, files, or documents unless separately
   requested.

## Example Prompt

```text
For the calendar meeting titled exactly '<meeting title>' on <date>, fetch the
meeting transcript or AI insights if available. Do not fetch unrelated emails,
Teams chats, files, documents, or other meetings. Create a concise bullet point
summary with decisions, action items, owners, dates, and open questions.
```

## Consent Boundary

Transcript, AI insight, mail, Teams, OneDrive, SharePoint, and M365 Copilot
queries are content reads. Treat each as explicit per-task consent, not a
standing permission.
