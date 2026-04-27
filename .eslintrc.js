module.exports = {
	root: true,
	env: { node: true, es2022: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
	extends: ['plugin:n8n-nodes-base/community'],
	rules: {
		'n8n-nodes-base/node-param-default-missing': 'error',
		'n8n-nodes-base/node-param-description-missing': 'warn',
	},
};
