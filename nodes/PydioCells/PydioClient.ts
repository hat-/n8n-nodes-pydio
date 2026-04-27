/**
 * Pydio Cells client.
 *
 * Two transport surfaces:
 *
 *  - **WebDAV** (`/dav/{workspace}/{path}`) — Basic auth `username:PAT`.
 *    Used for tree + binary ops: PUT, GET, MOVE, COPY, DELETE, MKCOL,
 *    PROPFIND. This is the only path that works reliably for non-admin
 *    PATs against Pydio Cells.
 *
 *  - **REST API** (`/a/...`) — Bearer auth `PAT`. Used for ops WebDAV
 *    can't do: full-text search and share-link creation.
 *
 * Paths are workspace-prefixed (`vox/folder/file.docx`). A leading `/`
 * prepends the credentials' default workspace.
 */
import {
	IExecuteFunctions,
	IDataObject,
	JsonObject,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

export interface PydioCreds {
	serverUrl: string;
	username: string;
	token: string;
	workspace: string;
	allowUnauthorizedCerts: boolean;
}

export interface PydioNode {
	Path: string;
	Type?: 'LEAF' | 'COLLECTION';
	Size?: string | number;
	MTime?: string | number;
	Etag?: string;
	Uuid?: string;
	MetaStore?: Record<string, unknown>;
}

function joinPath(...parts: string[]): string {
	return parts
		.map((p) => p.replace(/^\/+|\/+$/g, ''))
		.filter((p) => p.length > 0)
		.join('/');
}

export function normalizePath(path: string, defaultWorkspace: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error('Path is required');
	}
	if (trimmed.startsWith('/')) {
		return joinPath(defaultWorkspace, trimmed);
	}
	return trimmed.replace(/\/+$/, '');
}

function urlEncodePath(p: string): string {
	return p.split('/').map(encodeURIComponent).join('/');
}

export class PydioClient {
	private base: string;
	private basicAuth: string;
	constructor(
		private exec: IExecuteFunctions,
		private creds: PydioCreds,
	) {
		this.base = creds.serverUrl.replace(/\/+$/, '');
		this.basicAuth =
			'Basic ' +
			Buffer.from(`${creds.username}:${creds.token}`).toString('base64');
	}

	/* ----- Low-level transports --------------------------------------- */

	private async apiRequest<T = unknown>(
		method: 'GET' | 'POST',
		path: string,
		body?: unknown,
	): Promise<T> {
		const options: IDataObject = {
			method,
			url: `${this.base}${path}`,
			headers: { Authorization: `Bearer ${this.creds.token}` },
			json: true,
			body: body as IDataObject | undefined,
			skipSslCertificateValidation: this.creds.allowUnauthorizedCerts,
		};
		try {
			const helpers = this.exec.helpers as unknown as {
				httpRequest: (o: IDataObject) => Promise<unknown>;
			};
			return (await helpers.httpRequest(options)) as T;
		} catch (err) {
			throw new NodeApiError(this.exec.getNode(), err as JsonObject);
		}
	}

	private async dav(
		method:
			| 'GET'
			| 'PUT'
			| 'DELETE'
			| 'MKCOL'
			| 'PROPFIND'
			| 'MOVE'
			| 'COPY'
			| 'HEAD',
		path: string,
		opts: {
			body?: Buffer | string;
			headers?: Record<string, string>;
			binary?: boolean;
		} = {},
	): Promise<{ statusCode: number; body: Buffer | string }> {
		const url = `${this.base}/dav/${urlEncodePath(path)}`;
		const headers: Record<string, string> = {
			Authorization: this.basicAuth,
			...(opts.headers ?? {}),
		};
		const requestOptions: IDataObject = {
			method,
			url,
			headers,
			body: opts.body,
			returnFullResponse: true,
			json: false,
			skipSslCertificateValidation: this.creds.allowUnauthorizedCerts,
		};
		if (opts.binary) requestOptions.encoding = null;
		try {
			const helpers = this.exec.helpers as unknown as {
				httpRequest: (o: IDataObject) => Promise<{
					statusCode: number;
					body: Buffer | string;
					headers?: Record<string, string>;
				}>;
			};
			return await helpers.httpRequest(requestOptions);
		} catch (err) {
			// 404 / 207 are expected for some methods (PROPFIND multi-status,
			// HEAD on missing). Surface them via NodeApiError otherwise.
			throw new NodeApiError(this.exec.getNode(), err as JsonObject);
		}
	}

	private webdavUrl(path: string): string {
		return `${this.base}/dav/${urlEncodePath(path)}`;
	}

	/* ----- Tree ops (WebDAV) ----------------------------------------- */

	async exists(path: string): Promise<boolean> {
		const norm = normalizePath(path, this.creds.workspace);
		try {
			const res = await this.dav('PROPFIND', norm, {
				headers: { Depth: '0' },
			});
			return res.statusCode === 207 || res.statusCode === 200;
		} catch (err) {
			const e = err as { httpCode?: number | string; statusCode?: number };
			const code = Number(e.httpCode ?? e.statusCode);
			if (code === 404) return false;
			throw err;
		}
	}

	async stat(path: string): Promise<PydioNode | null> {
		// `/a/meta/get/{path}` is the only endpoint that returns the
		// node's Uuid synchronously (the search index lags fresh writes
		// by several seconds). PROPFIND would work for size/mtime but
		// not for share-link creation downstream.
		const norm = normalizePath(path, this.creds.workspace);
		try {
			return await this.apiRequest<PydioNode>(
				'POST',
				`/a/meta/get/${urlEncodePath(norm)}`,
				{},
			);
		} catch (err) {
			const e = err as { httpCode?: number | string; statusCode?: number };
			const code = Number(e.httpCode ?? e.statusCode);
			if (code === 404) return null;
			throw err;
		}
	}

	async list(folderPath: string, maxDepth = 1): Promise<PydioNode[]> {
		// `maxDepth`:
		//   1            → immediate children (single Depth=1 PROPFIND)
		//   N > 1 finite → iterative breadth-first: keep listing each folder
		//                  found at the previous level until we reach N
		//   0 (or any value <= 0) → unlimited (single Depth=infinity PROPFIND
		//                           — server walks the whole subtree)
		const norm = normalizePath(folderPath, this.creds.workspace);

		if (maxDepth <= 0) {
			return this._propfindChildren(norm, 'infinity');
		}
		if (maxDepth === 1) {
			return this._propfindChildren(norm, '1');
		}

		// Iterative BFS up to `maxDepth` levels. Each pass collects the
		// children of folders discovered in the previous pass.
		const all: PydioNode[] = [];
		const seen = new Set<string>();
		let frontier: string[] = [norm];
		for (let level = 0; level < maxDepth; level++) {
			const nextFrontier: string[] = [];
			for (const folder of frontier) {
				const children = await this._propfindChildren(folder, '1');
				for (const c of children) {
					if (seen.has(c.Path)) continue;
					seen.add(c.Path);
					all.push(c);
					if (c.Type === 'COLLECTION' && level < maxDepth - 1) {
						nextFrontier.push(c.Path);
					}
				}
			}
			frontier = nextFrontier;
			if (!frontier.length) break;
		}
		return all;
	}

	private async _propfindChildren(
		folder: string,
		depth: '1' | 'infinity',
	): Promise<PydioNode[]> {
		const res = await this.dav('PROPFIND', folder, {
			headers: { Depth: depth },
		});
		const props = parsePropfindEntries(res.body.toString());
		// Drop the entry that is the folder itself (Pydio echoes it as the
		// first href in PROPFIND results).
		const selfHref = `/dav/${urlEncodePath(folder)}/`;
		return props
			.filter((p) => p.href !== selfHref)
			.map((p) => webdavToNode(p, ''))
			.filter((n) => n.Path);
	}

	async createFolder(path: string): Promise<PydioNode> {
		const norm = normalizePath(path, this.creds.workspace);
		// Create intermediate parents by walking the path. WebDAV MKCOL only
		// creates one level; trying to create `a/b/c` directly when `b`
		// doesn't exist returns 409 Conflict.
		const segments = norm.split('/');
		for (let i = 2; i <= segments.length; i++) {
			const partial = segments.slice(0, i).join('/');
			try {
				const res = await this.dav('MKCOL', partial);
				if (![201, 405].includes(res.statusCode)) {
					// 405 = already exists (Method Not Allowed on existing collection)
					throw new NodeOperationError(
						this.exec.getNode(),
						`MKCOL ${partial} returned HTTP ${res.statusCode}`,
					);
				}
			} catch (err) {
				const e = err as { httpCode?: number | string; statusCode?: number };
				const code = Number(e.httpCode ?? e.statusCode);
				if (code !== 405) throw err;
			}
		}
		return { Path: norm, Type: 'COLLECTION' };
	}

	async delete(path: string, _permanent = false): Promise<void> {
		const norm = normalizePath(path, this.creds.workspace);
		await this.dav('DELETE', norm);
	}

	async moveOrCopy(
		source: string,
		target: string,
		mode: 'move' | 'copy',
	): Promise<void> {
		const src = normalizePath(source, this.creds.workspace);
		const tgt = normalizePath(target, this.creds.workspace);
		await this.dav(mode === 'move' ? 'MOVE' : 'COPY', src, {
			headers: {
				Destination: this.webdavUrl(tgt),
				Overwrite: 'F',
			},
		});
	}

	async rename(path: string, newName: string): Promise<void> {
		const norm = normalizePath(path, this.creds.workspace);
		const parent = norm.split('/').slice(0, -1).join('/');
		const target = parent ? `${parent}/${newName}` : newName;
		await this.moveOrCopy(norm, target, 'move');
	}

	async upload(path: string, content: Buffer): Promise<void> {
		const norm = normalizePath(path, this.creds.workspace);
		await this.dav('PUT', norm, {
			body: content,
			headers: { 'Content-Type': 'application/octet-stream' },
		});
	}

	async download(path: string): Promise<Buffer> {
		const norm = normalizePath(path, this.creds.workspace);
		const res = await this.dav('GET', norm, { binary: true });
		return Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
	}

	/* ----- Search + share (REST API) --------------------------------- */

	async search(
		query: string,
		options: { pathPrefix?: string; limit?: number } = {},
	): Promise<PydioNode[]> {
		const body: IDataObject = {
			Query: { FreeString: query },
			Size: options.limit ?? 100,
		};
		if (options.pathPrefix) {
			(body.Query as IDataObject).PathPrefix = [
				normalizePath(options.pathPrefix, this.creds.workspace) + '/',
			];
		}
		const res = await this.apiRequest<{ Results?: PydioNode[] }>(
			'POST',
			'/a/search/nodes',
			body,
		);
		return res.Results ?? [];
	}

	async createShareLink(
		path: string,
		options: {
			label?: string;
			expiresAfterSeconds?: number;
			password?: string;
			downloadOnly?: boolean;
		} = {},
	): Promise<{ Url: string; Uuid: string }> {
		const norm = normalizePath(path, this.creds.workspace);
		const node = await this.stat(norm);
		if (!node?.Uuid) {
			throw new NodeOperationError(
				this.exec.getNode(),
				`Cannot share: node not found at ${norm}`,
			);
		}
		const body: IDataObject = {
			Label: options.label ?? norm.split('/').pop() ?? 'shared',
			RootNodes: [{ Uuid: node.Uuid }],
			Permissions:
				options.downloadOnly === false
					? ['Read', 'Write']
					: ['Read', 'Download'],
		};
		if (options.expiresAfterSeconds) {
			body.AccessEnd =
				Math.floor(Date.now() / 1000) + options.expiresAfterSeconds;
		}
		if (options.password) body.PasswordRequired = true;
		const res = await this.apiRequest<{
			LinkHash?: string;
			LinkUrl?: string;
			Uuid?: string;
		}>('POST', '/a/share/link', body);
		const url = res.LinkUrl ?? `${this.base}/public/${res.LinkHash ?? ''}`;
		return { Url: url, Uuid: res.Uuid ?? '' };
	}
}

/* --- WebDAV PROPFIND parsing -------------------------------------- */

interface PropEntry {
	href: string;
	displayname?: string;
	contentlength?: string;
	contenttype?: string;
	lastmodified?: string;
	resourcetype?: 'collection' | 'leaf';
}

const HREF_RE = /<(?:D:)?href>([^<]+)<\/(?:D:)?href>/i;
const RESPONSE_RE = /<(?:D:)?response[\s\S]*?<\/(?:D:)?response>/gi;
const TAG_RE = (tag: string) =>
	new RegExp(`<(?:D:)?${tag}>([^<]*)<\\/(?:D:)?${tag}>`, 'i');
// Matches `<D:collection/>`, `<collection/>`, and namespace-decorated
// variants like `<D:collection xmlns:D="DAV:"/>` that Pydio Cells emits.
const COLLECTION_RE = /<(?:D:)?collection\b[^>]*\/?>(?:<\/(?:D:)?collection>)?/i;

function parsePropfindEntries(xml: string): PropEntry[] {
	const out: PropEntry[] = [];
	const responses = xml.match(RESPONSE_RE) ?? [];
	for (const r of responses) {
		const hrefMatch = r.match(HREF_RE);
		if (!hrefMatch) continue;
		const entry: PropEntry = {
			href: decodeURIComponent(hrefMatch[1]),
		};
		const dn = r.match(TAG_RE('displayname'));
		if (dn) entry.displayname = dn[1];
		const cl = r.match(TAG_RE('getcontentlength'));
		if (cl) entry.contentlength = cl[1];
		const ct = r.match(TAG_RE('getcontenttype'));
		if (ct) entry.contenttype = ct[1];
		const lm = r.match(TAG_RE('getlastmodified'));
		if (lm) entry.lastmodified = lm[1];
		entry.resourcetype = COLLECTION_RE.test(r) ? 'collection' : 'leaf';
		out.push(entry);
	}
	return out;
}

function webdavToNode(p: PropEntry, fallbackPath: string): PydioNode {
	// href looks like `/dav/vox/folder/file.docx` — strip the `/dav/` prefix.
	const m = p.href.match(/^\/dav\/(.*?)\/?$/);
	const path = m ? m[1] : fallbackPath;
	return {
		Path: path,
		Type: p.resourcetype === 'collection' ? 'COLLECTION' : 'LEAF',
		Size: p.contentlength ? Number(p.contentlength) : undefined,
		MTime: p.lastmodified,
	};
}
