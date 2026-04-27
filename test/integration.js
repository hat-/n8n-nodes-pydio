/**
 * Integration test for n8n-nodes-pydio.
 *
 * Exercises every operation against a real Pydio Cells server. Run with:
 *
 *   PYDIO_URL=https://tutum.universus.ca \
 *   PYDIO_TOKEN=... \
 *   PYDIO_WORKSPACE=vox \
 *   node test/integration.js
 *
 * Creates a sandbox folder, runs every operation in sequence, prints
 * pass/fail per step, and cleans up at the end.
 */
const { PydioClient } = require('../dist/nodes/PydioCells/PydioClient.js');

const URL = process.env.PYDIO_URL;
const USERNAME = process.env.PYDIO_USER;
const TOKEN = process.env.PYDIO_TOKEN;
const WORKSPACE = process.env.PYDIO_WORKSPACE || 'personal-files';
const SANDBOX = `${WORKSPACE}/n8n-test-${Date.now()}`;

if (!URL || !TOKEN || !USERNAME) {
	console.error('PYDIO_URL, PYDIO_USER and PYDIO_TOKEN env vars required');
	process.exit(1);
}

// Stub IExecuteFunctions enough that PydioClient.request() works.
const fakeExec = {
	getNode: () => ({ name: 'integration-test', type: 'pydio' }),
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
			if (opts.skipSslCertificateValidation) {
				const https = require('node:https');
				fetchOpts.agent = new https.Agent({ rejectUnauthorized: false });
			}
			const res = await fetch(opts.url, fetchOpts);
			const ct = res.headers.get('content-type') || '';
			let respBody;
			if (opts.encoding === null) {
				respBody = Buffer.from(await res.arrayBuffer());
			} else if (opts.returnFullResponse || ct.includes('xml')) {
				respBody = await res.text();
			} else if (ct.includes('application/json')) {
				respBody = await res.json();
			} else {
				respBody = await res.text();
			}
			if (!res.ok) {
				const text = typeof respBody === 'string' ? respBody : JSON.stringify(respBody);
				const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
				err.statusCode = res.status;
				err.httpCode = res.status;
				throw err;
			}
			if (opts.returnFullResponse) {
				return { statusCode: res.status, body: respBody, headers: Object.fromEntries(res.headers) };
			}
			return respBody;
		},
	},
};

const client = new PydioClient(fakeExec, {
	serverUrl: URL,
	username: USERNAME,
	token: TOKEN,
	workspace: WORKSPACE,
	allowUnauthorizedCerts: false,
});

let pass = 0, fail = 0;
async function step(name, fn) {
	process.stdout.write(`  [${(pass + fail + 1).toString().padStart(2)}] ${name}… `);
	try {
		const out = await fn();
		pass += 1;
		console.log('OK', out !== undefined ? `→ ${JSON.stringify(out).slice(0, 120)}` : '');
		return out;
	} catch (e) {
		fail += 1;
		console.log('FAIL');
		console.log(`       ${e.message}`);
		return null;
	}
}

async function main() {
	console.log(`\n=== n8n-nodes-pydio integration test ===`);
	console.log(`Server:   ${URL}`);
	console.log(`Sandbox:  ${SANDBOX}\n`);

	const filename = `hello.txt`;
	const filePath = `${SANDBOX}/${filename}`;
	const renamedFilename = `hello-renamed.txt`;
	const renamedPath = `${SANDBOX}/${renamedFilename}`;
	const subFolder = `${SANDBOX}/sub`;
	const movedPath = `${subFolder}/${renamedFilename}`;
	const copyPath = `${SANDBOX}/copy.txt`;
	const buf = Buffer.from('Hello from n8n-nodes-pydio integration test\n', 'utf8');

	await step(`exists(${SANDBOX}) (should be false)`, async () => {
		const e = await client.exists(SANDBOX);
		if (e) throw new Error('sandbox already exists — pick a unique name');
		return { exists: e };
	});
	await step(`createFolder(${SANDBOX})`, () => client.createFolder(SANDBOX));
	await step(`exists(${SANDBOX}) (should be true now)`, async () => {
		const e = await client.exists(SANDBOX);
		if (!e) throw new Error('sandbox not visible after create');
		return { exists: e };
	});
	await step(`upload(${filename})`, () => client.upload(filePath, buf));
	const meta = await step(`stat(${filename})`, () => client.stat(filePath));
	await step(`download(${filename}) round-trip`, async () => {
		const got = await client.download(filePath);
		if (Buffer.compare(got, buf) !== 0)
			throw new Error(`got ${got.length} bytes vs sent ${buf.length}`);
		return { bytes: got.length };
	});
	await step(`rename → ${renamedFilename}`, () => client.rename(filePath, renamedFilename));
	await step(`createFolder(${subFolder})`, () => client.createFolder(subFolder));
	await step(`move → ${movedPath}`, () => client.moveOrCopy(renamedPath, movedPath, 'move'));
	await step(`copy → ${copyPath}`, () => client.moveOrCopy(movedPath, copyPath, 'copy'));
	await step(`list(${SANDBOX}) recursive`, () => client.list(SANDBOX, true));
	await step(`search('hello-renamed', scope=${SANDBOX})`, () =>
		client.search('hello-renamed', { pathPrefix: SANDBOX, limit: 10 }),
	);
	// Note: createShareLink is intentionally NOT exercised here — the share
	// API has server-side policy requirements (forced expiry, mandatory
	// password) that vary per Pydio install. The client method exists but
	// the n8n node UI ships without it in v1.
	await step(`delete(${SANDBOX}) recursive`, () => client.delete(SANDBOX, true));
	await step(`exists(${SANDBOX}) (should be false again)`, async () => {
		const e = await client.exists(SANDBOX);
		if (e) throw new Error('sandbox still present after delete');
		return { exists: e };
	});

	console.log(`\nResult: ${pass} passed, ${fail} failed`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(2);
});
