# Feature: Event Staffing GitHub Collaboration

## Scope

Event Staffing supports an opt-in static collaboration mode when the page query contains `collab=true`. Normal application routes are unchanged. Administrator mode retains the Event Staffing workflow but makes people read-only and adds a GitHub collaboration panel. `user=true` renders a participant-only identity and availability page without application navigation.

## Repository and credentials

GitHub Pages deployments infer the owner/repository from the Pages URL. Localhost reads non-secret `VITE_GITHUB_OWNER` and `VITE_GITHUB_REPO` values. Generated participant links contain only mode flags, the session folder, token, and encryption password; dates, groups, events, requirements, and repository coordinates are loaded from the encrypted manifest or deployment configuration. The repository default branch is read through the GitHub API.

A short-lived fine-grained PAT with one-repository Contents read/write permission is required. The app verifies read access and creates/deletes a random probe file before enabling collaboration. Tokens and session passwords supplied in a URL are immediately moved to `sessionStorage` and removed from the address bar. They are never stored in project drafts or exported files.

The accepted shared-PAT link design remains a security risk: anyone with the original URL can extract and use the PAT until it expires. Scope and lifetime must therefore remain minimal.

## Encryption

Manifest and response files use Web Crypto PBKDF2-SHA-256 with 310,000 iterations to derive a 256-bit AES-GCM key. Every encrypted file has a random 16-byte salt and 12-byte IV. Passwords require at least 12 characters. Authentication failure, tampering, unsupported envelope versions, and wrong passwords fail closed.

## Repository layout

```text
.event-staffing-collab/
  session-slug--immutable-random-id/
    manifest.enc.json
    responses/
      sha256-session-and-normalized-email/
        response.enc.json
```

No name, email, or PIN appears in a repository path. GitHub folders are virtual and are created by writing the manifest/response files.

## Manifest and revisions

The encrypted manifest contains the immutable session ID/folder, display title, open/closed status, revision, timestamps, and the administrator-owned Event Staffing configuration: title/description, events, groups, requirements, cooldown rules, and global limits. People, preferences, and person-specific forced/forbidden assignments are excluded. Loading an existing session restores this configuration while preserving current participant records and still-relevant preference values. Publishing collaboration after configuration changes creates a new revision. Responses from another session or revision are reported as stale and cannot be applied.

## Participant workflow

After token verification and manifest decryption, participants enter mandatory first name, last name, email, and a four-digit PIN. The response path is derived from session ID plus normalized email. Load decrypts the existing response and verifies email/PIN. Save uses GitHub file SHA concurrency; conflicts require reload rather than automatic overwrite.

The table contains actual configured dates only, with a whole-day row and one row per configured group. Values are neutral, prefer, prefer not, or unavailable and map to standard `dayPreferences` and `dayGroupPreferences`.

## Administrator workflow

Administrators create/load a named encrypted session, manually refresh responses, inspect identity/change/stale/error counts, explicitly reveal individual encrypted PINs, and atomically apply valid previews. Matching uses case-insensitive email, creates new people, updates names, replaces represented session date/group values, and preserves non-session values and unmatched existing people. Duplicate emails or malformed/decryption failures block application.

Deleting a participant response is an explicit confirmed operation and removes the repository-derived person and related Event Staffing references. Closing a session publishes a new closed manifest revision; reads remain possible and participant saves are rejected.

## Testing

Automated tests inject mock fetch implementations or intercept all `api.github.com` requests. They never use the real repository, PAT, or `.env` file.
