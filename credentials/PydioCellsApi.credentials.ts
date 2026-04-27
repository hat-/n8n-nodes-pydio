import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PydioCellsApi implements ICredentialType {
	name = 'pydioCellsApi';
	displayName = 'Pydio Cells API';
	documentationUrl = 'https://pydio.com/en/docs/cells/v4/personal-access-tokens';
	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://cells.example.com',
			description:
				'Base URL of your Pydio Cells server. No trailing slash and no /a path component.',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'thomas',
			description:
				'The Pydio user the PAT belongs to. Required for WebDAV Basic auth on file/folder operations.',
		},
		{
			displayName: 'Personal Access Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Personal Access Token. Create one in Pydio Cells under Settings → Personal Access Tokens.',
		},
		{
			displayName: 'Default Workspace Slug',
			name: 'workspace',
			type: 'string',
			default: 'personal-files',
			description:
				'Workspace prefix used when paths are given without an explicit slug (e.g. "/myfolder/file.docx" → "personal-files/myfolder/file.docx"). Override per-call as needed.',
		},
		{
			displayName: 'Allow Unauthorized SSL Certificates',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: false,
			description: 'Tick if your Pydio server uses a self-signed certificate.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.serverUrl.replace(/\\/+$/, "")}}',
			url: '/a/frontend/state',
			method: 'GET',
			skipSslCertificateValidation:
				'={{$credentials.allowUnauthorizedCerts}}',
		},
	};
}
