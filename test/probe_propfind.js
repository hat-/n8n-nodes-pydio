/** Inspect raw PROPFIND XML for a folder vs file to see the resourcetype tag. */
const URL = process.env.PYDIO_URL;
const TOKEN = process.env.PYDIO_TOKEN;
const USER = process.env.PYDIO_USER;
const auth = 'Basic ' + Buffer.from(`${USER}:${TOKEN}`).toString('base64');

async function probe(path) {
	const fetch = (await import('node-fetch')).default;
	const res = await fetch(`${URL}/dav/${path}`, {
		method: 'PROPFIND',
		headers: { Authorization: auth, Depth: '1' },
	});
	const text = await res.text();
	console.log(`=== ${path} (HTTP ${res.status}) ===`);
	// Find each <D:response> block and show its href + resourcetype area
	const responses = text.match(/<D:response[\s\S]*?<\/D:response>/g) || [];
	for (const r of responses.slice(0, 4)) {
		const href = (r.match(/<D:href>([^<]+)<\/D:href>/) || [])[1];
		const rt = (r.match(/<D:resourcetype>([\s\S]*?)<\/D:resourcetype>/) || [])[1] || '(empty)';
		console.log(`  href=${href}  resourcetype=${rt.slice(0, 60)}`);
	}
}

(async () => {
	await probe('vox/');
})();
