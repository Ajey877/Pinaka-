# Pinaka-

Pinaka- is a browser-based coding agent that can inspect a repository, plan a change, edit code in an isolated workspace, run verification, repair failures, review the result, and work with GitHub.

## Start locally in one step

Pinaka runs in **Local Mode by default outside production**. You do not need to create a GitHub OAuth app just to try it.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

In Local Mode you can choose an AI provider, paste your own API key, enter a public GitHub repository URL, and start a coding task. GitHub sign-in is only needed later for account-specific features such as private repositories or creating/pushing GitHub changes.

Set `PINAKA_LOCAL_MODE=1` to explicitly enable Local Mode when running a production-configured process for local testing.

## AI choices

Pinaka supports **BYOK (bring your own key)** so the service does not need a shared Pinaka-owned model key. The web UI can use provider keys for Google Gemini, OpenRouter, Groq, OpenAI, or any OpenAI-compatible endpoint.

The UI highlights providers with a free tier. Free quotas belong to the provider and can change; Pinaka does not promise unlimited free AI usage.

Your AI key is submitted only with the task request, kept in runtime memory for that task, and is not written to the task object, task events, diffs, or Git history.

## GitHub

GitHub is optional for basic Local Mode use. When a GitHub session is available, Pinaka can use the authenticated account for account-scoped workflows such as private repositories and GitHub actions supported by the current approval flow.

The starter hosted configuration uses `public_repo read:user` by default. Private-repository access should be added later with a more granular GitHub authorization design.

## Easy deployment

### Deploy to Koyeb

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&builder=dockerfile&repository=github.com/Ajey877/Pinaka-&branch=foundation%2Fbootstrap&name=pinaka&service_type=web&ports=3000%3Bhttp%3B%2F)

The button deploys the repository using its included Dockerfile.

For a hosted deployment with GitHub account features, configure:

```text
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
GITHUB_OAUTH_REDIRECT_URI=https://YOUR-KOYEB-DOMAIN/auth/github/callback
PINAKA_PUBLIC_ORIGIN=https://YOUR-KOYEB-DOMAIN
PINAKA_COOKIE_SECURE=1
GITHUB_OAUTH_SCOPE=public_repo read:user
```

Do not put provider API keys into the hosted environment for normal BYOK use; users enter their own keys in the UI.

The free Koyeb instance is intended for lightweight/hobby use. It has limited CPU/RAM and does not provide persistent volumes, so a hosted Pinaka instance should not be treated as durable production storage.

### Docker

```bash
docker build -t pinaka .
docker run --rm -p 3000:3000 --env-file .env pinaka
```

## Development principles

- Local mode should work without external account setup.
- Inspect before modifying.
- Prefer the smallest safe change.
- Never claim a test passed unless it was actually run.
- Keep unrelated code untouched.
- Verify changes before considering a task complete.
- Keep model providers replaceable.
- Keep GitHub authorization optional until a GitHub capability actually requires it.
