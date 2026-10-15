# Feature: Event Staffing GitHub Collaboration

## Scope

Event Staffing supports an opt-in static collaboration mode when the page query contains `collab=true`. Normal application routes are unchanged. Administrator mode retains the Event Staffing workflow but makes people read-only and adds a GitHub collaboration panel. `user=true` renders a participant-only identity and availability page without application navigation.

Collaborative mode does not read from or write to normal `localStorage` drafts. Its in-memory Event Staffing project starts empty and is built only from the encrypted session manifest and participant response files in the collaboration folder. Collaboration credentials continue to use `sessionStorage` as described below.

## Repository and credentials

GitHub Pages deployments infer the owner/repository from the Pages URL. Localhost reads non-secret `VITE_GITHUB_OWNER` and `VITE_GITHUB_REPO` values. Generated participant links contain only mode flags, the session folder, token, and encryption password; dates, groups, events, requirements, and repository coordinates are loaded from the encrypted manifest or deployment configuration. The repository default branch is read through the GitHub API.

A short-lived fine-grained PAT with one-repository Contents read/write permission is required. The app verifies authenticated repository access and checks the repository push permission when GitHub provides it. It no longer creates/deletes probe files on page load; actual write permission is confirmed by session creation or participant save. Tokens and session passwords supplied in a URL are immediately moved to `sessionStorage` and removed from the address bar. They are never stored in project drafts or exported files.

The accepted shared-PAT link design remains a security risk: anyone with the original URL can extract and use the PAT until it expires. Scope and lifetime must therefore remain minimal.

## Encryption

Manifest and response files use Web Crypto PBKDF2-SHA-256 with 310,000 iterations to derive a 256-bit AES-GCM key. Every encrypted file has a random 16-byte salt and 12-byte IV. Passwords require at least 12 characters. Authentication failure, tampering, unsupported envelope versions, and wrong passwords fail closed.

## Repository layout

```text
.event-staffing-collab/
  session-slug--immutable-random-id/
    manifest.enc.json
    planning.enc.json
    responses/
      sha256-session-and-normalized-email/
        response.enc.json
```

No name, email, or PIN appears in a repository path. GitHub folders are virtual and are created by writing the manifest, planning, and response files. `planning.enc.json` exists only after an administrator saves a selected solution.

## Manifest and revisions

The encrypted manifest contains only session-owned data: the immutable session ID/folder, display title, open/closed status, revision, timestamps, and administrator-owned Event Staffing configuration such as title/description, events, groups, requirements, cooldown rules, and global limits. Participant identities and availability rules exist only in their encrypted response files; they are not duplicated in the manifest. Loading or refreshing a session validates the complete response set and atomically consolidates valid people and preferences into the administrator's in-memory project by normalized email. Repeated refreshes replace represented session values and do not duplicate people or preferences. Responses from another session or revision are reported as stale and none of the response set is applied.

## Participant workflow

After token verification and manifest decryption, participants enter mandatory first name, last name, email, and a four-digit PIN. The response path is derived from session ID plus normalized email. Load decrypts the existing response and verifies email/PIN. It then loads the current-revision planning when one exists and displays only that verified email's day, slot, and group assignments. No planning section is rendered when no current planning has been saved. Save uses GitHub file SHA concurrency. On a concurrent update or branch movement, it reloads the latest email/PIN-verified response, preserves remote values absent from the local form, overlays local edits, and retries with the newest SHA up to a bounded limit.

The table contains actual configured dates only, with a whole-day row and one row per configured group. Values are neutral, prefer, prefer not, or unavailable and map to standard `dayPreferences` and `dayGroupPreferences`.

## Administrator workflow

Administrators create/load a named encrypted session, manually refresh responses, inspect identity/change/stale/error counts, and explicitly reveal individual encrypted PINs. A valid refresh is atomically consolidated into memory. Matching uses case-insensitive email, creates new people, updates names, replaces represented session date/group values, and preserves non-session values and unmatched existing people. Duplicate emails or malformed/decryption failures block the complete refresh from being applied.

After solving, the administrator can select a returned solution and use **Save planning**. The selected assignments are validated against known participant emails, encrypted with the session envelope, and create or replace the session's single planning file using GitHub SHA concurrency. Planning is bound to the manifest session ID and revision; changing the session configuration makes an older planning invisible until a new selected solution is saved.

Deleting a participant response is an explicit confirmed operation and removes the repository-derived person and related Event Staffing references. Closing a session publishes a new closed manifest revision; reads remain possible and participant saves are rejected.

## Testing

Automated tests inject mock fetch implementations or intercept all `api.github.com` requests. They never use the real repository, PAT, or `.env` file.
