import { promises as fs } from "fs";
import os from "os";
import { App, arrayBufferToHex, CachedMetadata, TFile } from "obsidian";
import path from "path";

import slugify from "@sindresorhus/slugify";

import { buildConverter } from "./converter.js";
import { NoteFilter } from "./filter.js";
import { NotesPublisherSettings } from "./settings.js";

interface SyncedFile {
	hash: string,
	bundlePath: string
	attachments: string[]
}

type FrontmatterProcessorFunc = App['fileManager']['processFrontMatter'];

export class NotesSyncer {
	private settings: NotesPublisherSettings;
	private fmProcessor: FrontmatterProcessorFunc;
	private syncedIndex = new Map<string, SyncedFile>();

	enabled: boolean

	constructor(settings: NotesPublisherSettings, frontmatterProcessor: FrontmatterProcessorFunc) {
		this.settings = settings;
		this.fmProcessor = frontmatterProcessor;
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

	onFileCreate = () => {
		if (!this.enabled) return;
	}

	onFileDelete = () => {
		if (!this.enabled) return;
	}

	onFileUpdate = () => {
		if (!this.enabled) return;
	}

	onNoteUpdate = async (file: TFile, data: string, cache: CachedMetadata) => {
		if (!this.enabled) return;

		if (!this.settings.diskDestination)
			throw Error('invalid path for local synchronisation');

		const filter = new NoteFilter(this.settings.notesFilter);
		if (!filter.matches(cache.frontmatter)) return;
		const fm = cache.frontmatter!; // safe at this point

		const title: string = fm[this.settings.fmTitle] ?? file.basename;
		if (fm[this.settings.fmSlug] === undefined) {
			await this.fmProcessor(file, (fm) => {
				fm[this.settings.fmSlug] = '/' + slugify(title);
			});
			// this event is stalled now, bail out and lean on the next event
			return;
		}

		const hash = arrayBufferToHex(
			await crypto.subtle.digest("SHA-1", new TextEncoder().encode(data))
		);
		const knownHash = this.syncedIndex.get(file.path)?.hash;

		if (knownHash === hash) return;

		// TODO add validity checks for slug and section values
		const { section, converter } = buildConverter(
			fm, data, cache.frontmatterPosition!.end.offset, file.basename, this.settings
		);
		const slug = fm[this.settings.fmSlug];
		const bundlePath = path.join(this.resolveDiskDestination(), section, slug);
		this.syncedIndex.set(file.path, {
			hash: hash,
			bundlePath: bundlePath,
			attachments: [], // TODO
		});

		await converter.writeInto(bundlePath);
	}
}
