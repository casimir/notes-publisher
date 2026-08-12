import { App, requestUrl } from "obsidian"

import slugify from "@sindresorhus/slugify"

import { buildConverter, resolveAttachments } from "./converter.js"
import { filterAllNotes } from "./filter.js"
import { NotesPublisherSettings } from "./settings.js"

export interface RawFile {
	name: string
	content: Blob
}

export interface PublishResponse {
	id: string
	diff: string
}

export async function collectFiles(app: App, settings: NotesPublisherSettings): Promise<RawFile[]> {
	const notes = filterAllNotes(app, settings.notesFilter);
	const files = await Promise.all(notes.map(async (it) => {
		const cache = app.metadataCache.getFileCache(it)!;
		const fm = cache.frontmatter!;
		const data = await app.vault.cachedRead(it);

		const { title, section, converter } = buildConverter(cache, data, it.basename, settings);
		const slug = (fm[settings.fmSlug] as string | undefined) ?? slugify(title);
		const bundleDir = `${section}/${slug}`;

		const attachmentFiles = await Promise.all(resolveAttachments(app, converter.attachments, it.path).map(async ({ link, file }) => ({
			name: `${bundleDir}/${link}`,
			content: new Blob([await app.vault.readBinary(file)]),
		})));

		return [
			{ name: `${bundleDir}/index.md`, content: new Blob([converter.toCommonMark()]) },
			...attachmentFiles,
		];
	}));

	return files.flat();
}

export class Publisher {
	baseUrl: string
	token: string

	constructor(baseUrl: string, token: string) {
		this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
		this.token = token;
	}

	private async post(path: string, contentType: string, body: string | ArrayBuffer | undefined) {
		return await requestUrl({
			url: new URL(path, this.baseUrl).href,
			method: 'POST',
			contentType: contentType,
			headers: { Authorization: `Bearer ${this.token}` },
			body: body,
		});
	}

	async publish(files: RawFile[]) {
		const form = new FormData();
		for (const f of files) {
			form.append(f.name, f.content);
		}

		const encoded = new Response(form);
		const contentType = encoded.headers.get('Content-Type')!;
		const payload = await encoded.arrayBuffer();

		const resp = await this.post('publish', contentType, payload);
		return resp.json as PublishResponse
	}

	async confirm(id: string) {
		await this.post('confirm', 'application/json', JSON.stringify({ id }));
	}
}


