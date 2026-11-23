---
name: accounts
description: Act as the user on web APIs they signed in to, and offer a sign-in when a service needs one.
when_to_use: >-
   Data from a web API that needs the user's sign-in, token or API key (a Kaggle competition, a gated
   Hugging Face dataset, a service asking for a key), when a service refuses anonymous requests, or when
   the user has a token or key for a service and wants you to use it or asks to sign in. You never handle
   the key yourself: the app takes it on a sign-in card.
listed: true
always_on: false
tools: [api_fetch]
actions: [propose_signin]
---

# Signed-in API access

`api_fetch` makes one GET request as the user to a service they signed in to, or to a
built-in one (Hugging Face). The app attaches their secret; you never see, handle or
repeat it. It reaches only a sign-in's hosts: fetch public data from other hosts with the
terminal. The body is saved under `scratch/api/<service>/`; analyze it there in sandboxed
Python.

## Offering a sign-in

Offer one with `propose_signin` when the user asks to sign in, or when the data they asked
for needs it: a `needs_signin` refusal, a 401 or 403, or documentation saying the endpoint
needs a key. Do not offer it when anonymous access works.

For a service that is not built in, write the `spec` from its current API documentation,
read first rather than recalled, and use the kind of key it recommends now, not a legacy
one. Add `steps` the user takes on the site first, such as accepting a competition's rules
(use a `page` a refusal gave). When the service's CLI keeps a login on this computer (`gh`,
`kaggle`), add `local` to read it, so the user can reuse it.

The run pauses on the card, where the app takes and checks the key. Then:

- "Signed in": retry the request with `api_fetch`.
- The user continues without signing in: do not offer that sign-in again in this
  conversation. Work with what is open to everyone, or explain what is missing.
- A signed-in request that is refused again (`reason: rejected` or `terms`): tell the
  user what to fix, or offer the sign-in once more.

Never ask the user for a token, password or key in the chat, and never put one in a
command, file or argument. The card is the only place to sign in, and only the app can
use a saved key: the terminal cannot.
