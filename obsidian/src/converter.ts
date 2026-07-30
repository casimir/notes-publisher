import { promises as fs } from "fs";
import { FrontMatterCache } from "obsidian";
import path from "path";

import { NotesPublisherSettings } from "./settings.js";

export interface FrontMatterConfig {
	date: string,
	draft: string,
	title: string,
}

export function buildConverter(
	fm: FrontMatterCache,
	data: string,
	bodyOffset: number,
	fallbackTitle: string,
	settings: NotesPublisherSettings,
): { title: string, section: string, converter: NoteConverter } {
	const title: string = fm[settings.fmTitle] ?? fallbackTitle;
	const body = data.slice(bodyOffset).replace(/^\n/, '');
	const section = fm[settings.fmSection] ?? settings.defaultSection;

	const converter = new NoteConverter(title, {
		date: settings.fmDate,
		draft: settings.fmDraft,
		title: settings.fmTitle,
	});
	converter.convert(fm, body);

	return { title, section, converter };
}

export class NoteConverter {
	private noteTitle: string;
	private fmConfig: FrontMatterConfig;

	private convertedFm: [string, string][] | undefined;
	private convertedContent: string | undefined;

	constructor(title: string, fmConfig: FrontMatterConfig) {
		this.noteTitle = title;
		this.fmConfig = fmConfig;
	}

	convert(fm: FrontMatterCache, content: string) {
		this.processFrontMatter(fm);
		this.processContent(content);
	}

	private processFrontMatter(fm: FrontMatterCache) {
		this.convertedFm = [
			['title', this.noteTitle],
		];

		if (this.fmConfig.date in fm) {
			const date: string = fm[this.fmConfig.date];
			this.convertedFm.push(['date', date]);
		}

		if (this.fmConfig.draft in fm) {
			const value: boolean = fm[this.fmConfig.draft];
			this.convertedFm.push(['draft', value.toString()]);
		}
	}

	private processContent(content: string) {
		const processed = content
			// embedded image
			.replace(
				/!\[\[([^|\]]+\.(?:jpe?g|png|gif|svg))\|([^\]]+)\]\]/g,
				'![$2]($1)'
			);

		// in paragraph line break
		const lines = processed.split('\n');
		let inFence = false;
		this.convertedContent = lines
			.map((line, i) => {
				if (/^```/.test(line)) {
					inFence = !inFence;
					return line;
				}
				const next = lines[i + 1];
				if (inFence || line === '' || next === undefined || next === '')
					return line;
				return line + '  ';
			})
			.join('\n');
	}

	toCommonMark(): string {
		if (!this.convertedFm || !this.convertedContent)
			throw new Error('convert() must be called first');

		let fm = "---\n";
		for (const [k, v] of this.convertedFm) {
			fm += k + ": " + v + '\n';
		}
		fm += "---\n"
		return fm + '\n' + this.convertedContent;
	}

	async writeInto(dir: string) {
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'index.md'), this.toCommonMark(), 'utf-8');
	}
}

