/** Test type filter against pre-existing indexed content. */
const { PydioClient } = require('../dist/nodes/PydioCells/PydioClient.js');

const URL = process.env.PYDIO_URL;
const USER = process.env.PYDIO_USER;
const TOKEN = process.env.PYDIO_TOKEN;
const WORKSPACE = 'vox';

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
	const term = 'Sutton';
	const scope = 'vox/Z_Exemples';
	const all = await c.search(term, { pathPrefix: scope, limit: 50 });
	const files = await c.search(term, { pathPrefix: scope, type: 'LEAF', limit: 50 });
	const folders = await c.search(term, { pathPrefix: scope, type: 'COLLECTION', limit: 50 });

	console.log(`Search for "${term}" under ${scope}:`);
	console.log(`  all:     ${all.length}`);
	for (const n of all.slice(0, 5)) console.log(`    ${n.Type}: ${n.Path}`);
	console.log(`  LEAF only:        ${files.length}`);
	for (const n of files.slice(0, 5)) console.log(`    ${n.Type}: ${n.Path}`);
	console.log(`  COLLECTION only:  ${folders.length}`);
	for (const n of folders.slice(0, 5)) console.log(`    ${n.Type}: ${n.Path}`);

	const filesOk = files.length === 0 || files.every((n) => n.Type === 'LEAF');
	const foldersOk = folders.length === 0 || folders.every((n) => n.Type === 'COLLECTION');
	const sumOk = files.length + folders.length === all.length;
	console.log(`\nfiles purity:   ${filesOk ? 'PASS' : 'FAIL'}`);
	console.log(`folders purity: ${foldersOk ? 'PASS' : 'FAIL'}`);
	console.log(`sum equals all: ${sumOk ? 'PASS' : 'FAIL'}`);
	process.exit(filesOk && foldersOk && sumOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
