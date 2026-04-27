# n8n-nodes-pydio

Community node for **Pydio Cells** in [n8n](https://n8n.io/).
File and folder operations against any Pydio Cells server with a Personal
Access Token. No `cec` binary required on the n8n host — talks directly
to the Pydio REST API.

## Install

In your n8n instance: **Settings → Community Nodes → Install** and enter
`n8n-nodes-pydio`. Restart n8n.

## Credentials

In n8n create a new credential of type **Pydio Cells API** with:

| Field | Value |
|---|---|
| **Server URL** | `https://your-cells.example.com` (no trailing slash, no `/a`) |
| **Personal Access Token** | Generated in Pydio under *Settings → Personal Access Tokens* |
| **Default Workspace Slug** | e.g. `personal-files` (used when paths start with `/`) |
| **Allow Unauthorized SSL Certs** | Tick only if your server uses a self-signed certificate |

## Operations

### File

| Operation | Inputs | Output |
|---|---|---|
| **Upload** | `path`, binary property | `{ path, uploaded, bytes }` |
| **Download** | `path` | item with binary property |
| **Move** | `path`, `targetPath` | `{ path, target, moved }` |
| **Copy** | `path`, `targetPath` | `{ path, target, copied }` |
| **Rename** | `path`, `newName` | `{ path, newName, renamed }` |
| **Delete** | `path`, `permanent` | `{ path, deleted, permanent }` |
| **Get Metadata** | `path` | Pydio node object (size, mtime, uuid, …) |
| **Exists** | `path` | `{ path, exists }` |
| **Search** | `query`, optional `scopePathPrefix`, `limit` | `{ results: [...] }` (files only) |
| **Get Share Link** | `path`, optional label/expiry/password/allowUpload | `{ Url, Uuid }` |

### Folder

| Operation | Inputs | Output |
|---|---|---|
| **Create** | `path` | created node |
| **Move** | `path`, `targetPath` | `{ moved }` (recursive) |
| **Copy** | `path`, `targetPath` | `{ copied }` (recursive) |
| **Rename** | `path`, `newName` | `{ renamed }` |
| **Delete** | `path`, `permanent` | `{ deleted }` (recursive) |
| **List** | `path`, `maxDepth` | `{ results: [...] }` |
| **Exists** | `path` | `{ exists }` |
| **Search** | `query`, optional `scopePathPrefix`, `limit` | `{ results: [...] }` (folders only) |

### Folder list depth

`Max Depth` controls how many levels are walked. `1` (default) returns only
the immediate children of the listed folder. `2` adds grandchildren, and so
on. `0` walks the entire subtree (one server call but can be slow on large
folders — Pydio's WebDAV honours `Depth: infinity` server-side). Anything
`>= 2` does iterative breadth-first listing client-side, one PROPFIND per
folder per level.

## Path conventions

- `personal-files/inbox/file.docx` → workspace-prefixed (preferred form)
- `/inbox/file.docx` → leading `/` prepends the credentials' Default
  Workspace Slug

## Example workflows

**Move every file in `/inbox` to `/processed/<date>/` after processing:**

1. **Pydio Cells → Folder → List** (`path: /inbox`)
2. **For each** result:
   - Process the file (your nodes)
   - **Pydio Cells → File → Move** (`path: {{ $json.Path }}`,
     `targetPath: /processed/{{ $today.format("yyyy-MM-dd") }}/{{ $json.Path.split("/").pop() }}`)

**Email a daily report's share link:**

1. Whatever produces the file → **Pydio Cells → File → Upload**
2. **Pydio Cells → File → Get Share Link**
   (`path: ...`, `expiresAfterSeconds: 604800` for 7 days)
3. **Email Send** (`{{ $json.Url }}`)

## Build & develop locally

```sh
npm install
npm run build       # tsc + copy icons to dist/
npm run lint
npm link            # then `npm link n8n-nodes-pydio` from your n8n install root
```

## Pydio API endpoints used

| Operation | Method | Path |
|---|---|---|
| Stat / list / search | `POST` | `/a/search/nodes` |
| Create folder | `POST` | `/a/tree/create` |
| Delete | `POST` | `/a/tree/delete` |
| Move / copy | `POST` | `/a/jobs/copy-or-move` |
| Upload | `PUT`  | `/io/{workspace}/{path}` |
| Download | `GET`  | `/io/{workspace}/{path}` |
| Share link | `POST` | `/a/share/link` |
| Auth probe | `GET`  | `/a/frontend/state` |

All requests carry `Authorization: Bearer <PAT>`.

## License

MIT — © 2026 Thomas Dedes. See [LICENSE](LICENSE).
