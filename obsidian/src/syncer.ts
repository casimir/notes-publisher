import { promises as fs } from "fs";
import os from "os";
import { App, arrayBufferToHex, CachedMetadata, FrontMatterCache, TAbstractFile, TFile } from "obsidian";
import path from "path";

import slugify from "@sindresorhus/slugify";

import { buildConverter, resolveAttachments } from "./converter.js";
import { NoteFilter } from "./filter.js";
import { NotesPublisherSettings } from "./settings.js";

interface SyncedAttachment {
	vaultPath: string
	bundleRelative: string
}

interface SyncedFile {
	hash: string,
	bundlePath: string
	attachments: SyncedAttachment[]
}

export class NotesSyncer {
	private app: App;
	private settings: NotesPublisherSettings;
	private syncedIndex = new Map<string, SyncedFile>();

	enabled: boolean

	constructor(app: App, settings: NotesPublisherSettings) {
		this.app = app;
		this.settings = settings;
		this.enabled = false;
	}

	resolveDiskDestination() {
		const base = this.settings.diskDestination;
		return base.startsWith('~/')
			? path.join(os.homedir(), base.slice(1))
			: base;
	}

	async reset() {
		const matches = fs.glob(path.join(this.resolveDiskDestination(), '*'));
		for await (const it of matches) {
			await fs.rm(it, { recursive: true });
		}
		this.syncedIndex.clear();
	}

	onFileDelete = async (file: TAbstractFile) => {
		if (!this.enabled) return;

		if (file instanceof TFile && file.extension === 'md') {
			const entry = this.syncedIndex.get(file.path);
			if (!entry) return;
			await fs.rm(entry.bundlePath, { recursive: true, force: true });
			this.syncedIndex.delete(file.path);
			return;
		}

		for (const entry of this.syncedIndex.values()) {
			const idx = entry.attachments.findIndex((a) => a.vaultPath === file.path);
			if (idx === -1) continue;
			await fs.rm(path.join(entry.bundlePath, entry.attachments[idx]!.bundleRelative), { force: true });
			entry.attachments.splice(idx, 1);
		}
	}

	onFileUpdate = async (file: TAbstractFile) => {
		if (!this.enabled) return;
		if (!(file instanceof TFile)) return;

		for (const entry of this.syncedIndex.values()) {
			const attachment = entry.attachments.find((a) => a.vaultPath === file.path);
			if (!attachment) continue;
			const target = path.join(entry.bundlePath, attachment.bundleRelative);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, new Uint8Array(await this.app.vault.readBinary(file)));
		}
	}

	onFileRename = async (file: TAbstractFile, oldPath: string) => {
		if (!this.enabled) return;

		if (file instanceof TFile && file.extension === 'md') {
			const entry = this.syncedIndex.get(oldPath);
			if (!entry) return;
			this.syncedIndex.delete(oldPath);
			this.syncedIndex.set(file.path, entry);
			return;
		}

		for (const entry of this.syncedIndex.values()) {
			const attachment = entry.attachments.find((a) => a.vaultPath === oldPath);
			if (!attachment) continue;
			await fs.rm(path.join(entry.bundlePath, attachment.bundleRelative), { force: true });
			attachment.vaultPath = file.path;
		}
	}

	onNoteUpdate = async (file: TFile, data: string, cache: CachedMetadata) => {
		if (!this.enabled) return;

		if (!this.settings.diskDestination)
			throw Error('invalid path for local synchronisation');

		const filter = new NoteFilter(this.settings.notesFilter);
		if (!filter.matches(cache.frontmatter)) return;
		const fm = cache.frontmatter!;

		const title = (fm[this.settings.fmTitle] as string | undefined) ?? file.basename;
		if (fm[this.settings.fmSlug] === undefined) {
			await this.app.fileManager.processFrontMatter(file, (fm: FrontMatterCache) => {
				fm[this.settings.fmSlug] = '/' + slugify(title);
			});
			// this event is stalled now, bail out and lean on the next event
			return;
		}

		const hash = arrayBufferToHex(
			await crypto.subtle.digest("SHA-1", new TextEncoder().encode(data))
		);
		const previous = this.syncedIndex.get(file.path);
		if (previous?.hash === hash) return;

		// TODO add validity checks for slug and section values
		const { section, converter } = buildConverter(cache, data, file.basename, this.settings);
		const slug = fm[this.settings.fmSlug] as string;
		const bundlePath = path.join(this.resolveDiskDestination(), section, slug);

		await converter.writeInto(bundlePath);

		const resolved = resolveAttachments(this.app, converter.attachments, file.path);
		for (const { link, file: attachment } of resolved) {
			const target = path.join(bundlePath, link);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, new Uint8Array(await this.app.vault.readBinary(attachment)));
		}

		const newVaultPaths = new Set(resolved.map((r) => r.file.path));
		for (const old of previous?.attachments ?? []) {
			if (!newVaultPaths.has(old.vaultPath)) {
				await fs.rm(path.join(bundlePath, old.bundleRelative), { force: true });
			}
		}

		// if a link failed to resolve, don't cache the hash so the next changed event retries
		const allResolved = resolved.length === converter.attachments.length;
		this.syncedIndex.set(file.path, {
			hash: allResolved ? hash : '',
			bundlePath,
			attachments: resolved.map((r) => ({ vaultPath: r.file.path, bundleRelative: r.link })),
		});
	}
}
