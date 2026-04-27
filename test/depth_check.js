/**
 * Verify list() returns different result counts at different depths.
 * Builds a 4-level-deep tree and lists at depths 1, 2, 3, 4, 0(=∞).
 */
const { PydioClient } = require('../dist/nodes/PydioCells/PydioClient.js');

const URL = process.env.PYDIO_URL;
const USERNAME = process.env.PYDIO_USER;
const TOKEN = process.env.PYDIO_TOKEN;
const WORKSPACE = process.env.PYDIO_WORKSPACE || 'personal-files';
const SANDBOX = `${WORKSPACE}/depth-check-${Date.now()}`;

const fakeExec = {
	getNode: () => ({ name: 'depth-check', type: 'pydio' }),
	helpers: {
		httpRequest: async (opts) => {
			const fetch = (await import('node-fetch')).default;
			const headers = { ...(opts.headers || {}) };
			let body = opts.body;
			if (opts.json && body !== undefined && typeof body !== 'string') {
				headers['Content-Type'] = 'application/json';
				body = JSON.stringify(body);
			}
			const fetchOpts = { method: opts.method, headers, body };
			const res = await fetch(opts.url, fetchOpts);
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

const client = new PydioClient(fakeExec, {
	serverUrl: URL, username: USERNAME, token: TOKEN,
	workspace: WORKSPACE, allowUnauthorizedCerts: false,
});

async function main() {
	console.log(`Sandbox: ${SANDBOX}`);
	// Build:
	//   SANDBOX/L1file.txt
	//   SANDBOX/L1dir/L2file.txt
	//   SANDBOX/L1dir/L2dir/L3file.txt
	//   SANDBOX/L1dir/L2dir/L3dir/L4file.txt
	const buf = Buffer.from('x', 'utf8');
	await client.createFolder(`${SANDBOX}/L1dir/L2dir/L3dir`);
	await client.upload(`${SANDBOX}/L1file.txt`, buf);
	await client.upload(`${SANDBOX}/L1dir/L2file.txt`, buf);
	await client.upload(`${SANDBOX}/L1dir/L2dir/L3file.txt`, buf);
	await client.upload(`${SANDBOX}/L1dir/L2dir/L3dir/L4file.txt`, buf);
	console.log('built tree');

	for (const d of [1, 2, 3, 4, 5, 0]) {
		const res = await client.list(SANDBOX, d);
		const paths = res.map((n) => n.Path.replace(SANDBOX + '/', '')).sort();
		console.log(`\ndepth=${d}: ${res.length} entries`);
		for (const p of paths) console.log(`  ${p}`);
	}

	await client.delete(SANDBOX, true);
	console.log('\ncleaned up');
}
main().catch((e) => { console.error(e); process.exit(1); });
