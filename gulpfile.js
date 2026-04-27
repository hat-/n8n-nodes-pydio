const { src, dest } = require('gulp');

function buildIcons() {
	const nodes = src(['nodes/**/*.{png,svg}']).pipe(dest('dist/nodes'));
	const creds = src(['credentials/**/*.{png,svg}']).pipe(
		dest('dist/credentials'),
	);
	return Promise.all([
		new Promise((r) => nodes.on('end', r)),
		new Promise((r) => creds.on('end', r)),
	]);
}

exports['build:icons'] = buildIcons;
