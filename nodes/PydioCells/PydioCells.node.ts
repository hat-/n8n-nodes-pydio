/**
 * Pydio Cells — n8n community node.
 *
 * Resources:
 *   - file:   upload, download, move, copy, rename, delete, get, exists, search, getShareLink
 *   - folder: create, move, copy, rename, delete, list, exists
 *
 * Auth: PydioCellsApi credentials (server URL + Personal Access Token).
 */
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { PydioClient, PydioCreds } from './PydioClient';

export class PydioCells implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pydio Cells',
		name: 'pydioCells',
		icon: 'file:pydio.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage files & folders in Pydio Cells',
		defaults: {
			name: 'Pydio Cells',
		},
		// In n8n-workflow >=1.x the connection type is a literal string union;
		// using "main" keeps the node compatible with both pre- and post-1.0 SDKs.
		inputs: ['main' as never],
		outputs: ['main' as never],
		credentials: [
			{
				name: 'pydioCellsApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'file',
				options: [
					{ name: 'File', value: 'file' },
					{ name: 'Folder', value: 'folder' },
				],
			},
			/* ---------- File ops ---------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['file'] } },
				default: 'upload',
				options: [
					{ name: 'Upload', value: 'upload', action: 'Upload a file', description: 'Upload binary content from the input to a Pydio path' },
					{ name: 'Download', value: 'download', action: 'Download a file', description: 'Get the file binary into the workflow' },
					{ name: 'Move', value: 'move', action: 'Move a file', description: 'Move a file to a new path' },
					{ name: 'Copy', value: 'copy', action: 'Copy a file', description: 'Duplicate a file to a new path' },
					{ name: 'Rename', value: 'rename', action: 'Rename a file', description: 'Rename a file in place (parent unchanged)' },
					{ name: 'Delete', value: 'delete', action: 'Delete a file' },
					{ name: 'Get Metadata', value: 'get', action: 'Get file metadata', description: 'Size, mtime, etag, uuid, type' },
					{ name: 'Exists', value: 'exists', action: 'Check if a file exists' },
					{ name: 'Search', value: 'search', action: 'Search files', description: 'Search by free-string query, optionally scoped to a folder' },
				],
			},
			/* ---------- Folder ops ---------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['folder'] } },
				default: 'list',
				options: [
					{ name: 'Create', value: 'create', action: 'Create a folder' },
					{ name: 'Move', value: 'move', action: 'Move a folder', description: 'Recursively moves the folder and all its content' },
					{ name: 'Copy', value: 'copy', action: 'Copy a folder', description: 'Recursively duplicates the folder and all its content' },
					{ name: 'Rename', value: 'rename', action: 'Rename a folder' },
					{ name: 'Delete', value: 'delete', action: 'Delete a folder', description: 'Recursively deletes the folder and all its content' },
					{ name: 'List', value: 'list', action: 'List folder contents', description: 'List immediate children (or recursive)' },
					{ name: 'Exists', value: 'exists', action: 'Check if a folder exists' },
					{ name: 'Search', value: 'search', action: 'Search folders', description: 'Search for folders by free-string query, optionally scoped to a parent folder' },
				],
			},
			/* ---------- Common path ---------- */
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'personal-files/inbox/report.docx',
				description:
					'Workspace-prefixed path. A leading "/" prepends the credentials default workspace.',
				displayOptions: {
					hide: { operation: ['search'] },
				},
			},
			/* ---------- Move/Copy/Rename target ---------- */
			{
				displayName: 'Target Path',
				name: 'targetPath',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'personal-files/archive/report.docx',
				displayOptions: {
					show: { operation: ['move', 'copy'] },
				},
			},
			{
				displayName: 'New Name',
				name: 'newName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'report-final.docx',
				displayOptions: {
					show: { operation: ['rename'] },
				},
			},
			/* ---------- Upload ---------- */
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				description:
					'Name of the binary property on the input item that holds the file to upload',
				displayOptions: { show: { operation: ['upload'] } },
			},
			/* ---------- Download ---------- */
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				description:
					'Name of the binary property on the output item that will hold the downloaded file',
				displayOptions: { show: { operation: ['download'] } },
			},
			/* ---------- Delete options ---------- */
			{
				displayName: 'Permanent Delete',
				name: 'permanent',
				type: 'boolean',
				default: false,
				description:
					'If on, bypasses the recycle bin and removes immediately',
				displayOptions: { show: { operation: ['delete'] } },
			},
			/* ---------- List options ---------- */
			{
				displayName: 'Max Depth',
				name: 'maxDepth',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0 },
				description:
					'How many folder levels deep to descend. 1 = immediate children only. 2 = children + grandchildren. 0 = unlimited (whole subtree — slow on large folders).',
				displayOptions: { show: { resource: ['folder'], operation: ['list'] } },
			},
			/* ---------- Search ---------- */
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'report-2025',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Scope (Path Prefix)',
				name: 'scopePathPrefix',
				type: 'string',
				default: '',
				placeholder: 'personal-files/clients/',
				description:
					'Restrict the search to nodes under this path prefix (optional)',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Limit',
				name: 'searchLimit',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 1000 },
				displayOptions: { show: { operation: ['search'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credsRaw = (await this.getCredentials('pydioCellsApi')) as unknown as PydioCreds;
		const creds: PydioCreds = {
			serverUrl: credsRaw.serverUrl,
			username: credsRaw.username,
			token: credsRaw.token,
			workspace: credsRaw.workspace || 'personal-files',
			allowUnauthorizedCerts: !!credsRaw.allowUnauthorizedCerts,
		};
		const client = new PydioClient(this, creds);
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;

			try {
				let result: unknown;
				let binary: INodeExecutionData['binary'];

				if (operation === 'search') {
					const query = this.getNodeParameter('query', i) as string;
					const scope = this.getNodeParameter('scopePathPrefix', i, '') as string;
					const limit = this.getNodeParameter('searchLimit', i, 100) as number;
					// Type filter is implicit in the resource: File search → LEAF
					// only, Folder search → COLLECTION only.
					const typeFilter: 'LEAF' | 'COLLECTION' =
						resource === 'folder' ? 'COLLECTION' : 'LEAF';
					result = await client.search(query, {
						pathPrefix: scope || undefined,
						limit,
						type: typeFilter,
					});
				} else {
					const path = this.getNodeParameter('path', i) as string;

					if (operation === 'get') {
						result = await client.stat(path);
					} else if (operation === 'exists') {
						result = { path, exists: await client.exists(path) };
					} else if (operation === 'create' && resource === 'folder') {
						result = await client.createFolder(path);
					} else if (operation === 'delete') {
						const permanent = this.getNodeParameter('permanent', i, false) as boolean;
						await client.delete(path, permanent);
						result = { path, deleted: true, permanent };
					} else if (operation === 'move') {
						const target = this.getNodeParameter('targetPath', i) as string;
						await client.moveOrCopy(path, target, 'move');
						result = { path, target, moved: true };
					} else if (operation === 'copy') {
						const target = this.getNodeParameter('targetPath', i) as string;
						await client.moveOrCopy(path, target, 'copy');
						result = { path, target, copied: true };
					} else if (operation === 'rename') {
						const newName = this.getNodeParameter('newName', i) as string;
						await client.rename(path, newName);
						result = { path, newName, renamed: true };
					} else if (operation === 'list' && resource === 'folder') {
						const maxDepth = this.getNodeParameter('maxDepth', i, 1) as number;
						result = await client.list(path, maxDepth);
					} else if (operation === 'upload') {
						const binaryProperty = this.getNodeParameter(
							'binaryProperty',
							i,
						) as string;
						const buf = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
						await client.upload(path, buf);
						result = { path, uploaded: true, bytes: buf.length };
					} else if (operation === 'download') {
						const buf = await client.download(path);
						const outName = this.getNodeParameter(
							'outputBinaryProperty',
							i,
						) as string;
						const filename = path.split('/').pop() || 'download.bin';
						binary = {
							[outName]: await this.helpers.prepareBinaryData(
								buf,
								filename,
							),
						};
						result = { path, downloaded: true, bytes: buf.length };
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`Unsupported operation: ${resource}.${operation}`,
							{ itemIndex: i },
						);
					}
				}

				const json: import('n8n-workflow').IDataObject =
					result === null || result === undefined
						? {}
						: Array.isArray(result)
							? { results: result }
							: (result as import('n8n-workflow').IDataObject);
				out.push({ json, binary, pairedItem: { item: i } });
			} catch (err) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: (err as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw err;
			}
		}

		return [out];
	}
}
