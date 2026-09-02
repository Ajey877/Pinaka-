# Pinaka-

Pinaka- is a browser-based coding agent that can inspect a GitHub repository, plan a change, edit code in an isolated workspace, run verification, repair failures, review the result, and work with GitHub.

## AI choices

Pinaka supports **BYOK (bring your own key)** so the service does not need a shared Pinaka-owned model key. The web UI can use provider keys for Google Gemini, OpenRouter, Groq, OpenAI, or any OpenAI-compatible endpoint.

The UI also highlights providers with a free tier. Free quotas belong to the provider and can change; Pinaka does not promise unlimited free AI usage.

Your AI key is submitted only with the task request, kept in runtime memory for that task, and is not written to the task object, task events, diffs, or Git history.

## Easy deployment

### Deploy to Koyeb

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&builder=dockerfile&repository=github.com/Ajey877/Pinaka-&branch=foundation%2Fbootstrap&name=pinaka&service_type=web&ports=3000%3Bhttp%3B%2F)

The button deploys the repository using its included Dockerfile. Koyeb supports GitHub-backed deployment and Dockerfile builds. citeturn645495search0turn645495search2

For the first hosted deployment, configure these environment variables in Koyeb:

```text
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
GITHUB_OAUTH_REDIRECT_URI=https://YOUR-KOYEB-DOMAIN/auth/github/callback
PINAKA_PUBLIC_ORIGIN=https://YOUR-KOYEB-DOMAIN
PINAKA_COOKIE_SECURE=1
GITHUB_OAUTH_SCOPE=public_repo read:user
```

Then open the generated `.koyeb.app` URL, sign in with GitHub, choose an AI provider, enter the provider key, test the connection, and start a coding task.

Koyeb documents its generated public-domain environment variables and GitHub/Dockerfile deployment flow. citeturn645495search6turn645495search4

**Important:** the free Koyeb instance is intended for lightweight/hobby use. It has limited CPU/RAM and does not provide persistent volumes, so a hosted Pinaka instance should not be treated as durable production storage. citeturn645495search6

### Docker

```bash
docker build -t pinaka .
docker run --rm -p 3000:3000 --env-file .env pinaka
```

### Local

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## GitHub OAuth

The starter configuration uses `public_repo read:user` by default. This deliberately limits the initial hosted deployment to public repositories. Private-repository access should be added later with a more granular GitHub authorization design.

## Development principles

- Inspect before modifying.
- Prefer the smallest safe change.
- Never claim a test passed unless it was actually run.
- Keep unrelated code untouched.
- Verify changes before considering a task complete.
- Keep model providers replaceable.
- Build the system in small, testable phases.
