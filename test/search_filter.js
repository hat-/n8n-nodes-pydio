/** Verify search type filter — file search returns LEAF only, folder
 * search returns COLLECTION only. */
const { PydioClient } = require('../dist/nodes/PydioCells/PydioClient.js');

const URL = process.env.PYDIO_URL;
const USER = process.env.PYDIO_USER;
const TOKEN = process.env.PYDIO_TOKEN;
const WORKSPACE = process.env.PYDIO_WORKSPACE || 'personal-files';
const SANDBOX = `${WORKSPACE}/search-filter-${Date.now()}`;

const fakeExec = {
	getNode: () => ({ name: 'search-test', type: 'pydio' }),
	helpers: {
		httpRequest: async (opts) => {
			const fetch = (await import('node-fetch')).default;
			const headers = { ...(opts.headers || {}) };
			let body = opts.body;
			if (opts.json && body !== undefined && typeof body !== 'string') {
				headers['Content-Type'] = 'application/json';
				body = JSON.stringify(body);
			}
			const res = await fetch(opts.url, { method: opts.method, headers, body });
			let respBody;
			if (opts.encoding === null) respBody = Buffer.from(await res.arrayBuffer());
			else if (opts.returnFullResponse) respBody = await res.text();
			else if ((res.headers.get('content-type') || '').includes('json')) respBody = await res.json();
			else respBody = await res.text();
			if (!res.ok) {
				const t = typeof respBody === 'string' ? respBody : JSON.stringify(respBody);
				const e = new Error(`HTTP ${res.status} ${res.statusText}: ${t.slice(0, 400)}`);
				e.statusCode = res.status; e.httpCode = res.status; throw e;
			}
			if (opts.returnFullResponse)
				return { statusCode: res.status, body: respBody, headers: Object.fromEntries(res.headers) };
			return respBody;
		},
	},
};
const c = new PydioClient(fakeExec, { serverUrl: URL, username: USER, token: TOKEN, workspace: WORKSPACE, allowUnauthorizedCerts: false });

(async () => {
	console.log(`Sandbox: ${SANDBOX}`);
	const tag = `qz${Date.now().toString(36)}`;
	// One folder + one file, both with the unique tag in their name.
	await c.createFolder(`${SANDBOX}/${tag}folder`);
	await c.upload(`${SANDBOX}/${tag}file.txt`, Buffer.from('x'));
	console.log(`indexed tag: ${tag}`);

	// Wait for indexing — Pydio's search is async.
	for (let attempt = 0; attempt < 10; attempt++) {
		const all = await c.search(tag, { pathPrefix: SANDBOX });
		if (all.length >= 2) break;
		await new Promise((r) => setTimeout(r, 2000));
	}

	const all = await c.search(tag, { pathPrefix: SANDBOX });
	const files = await c.search(tag, { pathPrefix: SANDBOX, type: 'LEAF' });
	const folders = await c.search(tag, { pathPrefix: SANDBOX, type: 'COLLECTION' });

	console.log(`\nall:     ${all.length}  →  ${all.map((n) => `${n.Type}:${n.Path.split('/').pop()}`).join(', ')}`);
	console.log(`files:   ${files.length}  →  ${files.map((n) => `${n.Type}:${n.Path.split('/').pop()}`).join(', ')}`);
	console.log(`folders: ${folders.length}  →  ${folders.map((n) => `${n.Type}:${n.Path.split('/').pop()}`).join(', ')}`);

	const filesOk = files.every((n) => n.Type === 'LEAF') && files.length >= 1;
	const foldersOk = folders.every((n) => n.Type === 'COLLECTION') && folders.length >= 1;
	console.log(`\nfiles filter ok:   ${filesOk ? 'PASS' : 'FAIL'}`);
	console.log(`folders filter ok: ${foldersOk ? 'PASS' : 'FAIL'}`);

	await c.delete(SANDBOX, true);
	process.exit(filesOk && foldersOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
