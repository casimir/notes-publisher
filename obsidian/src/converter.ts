import { promises as fs } from "fs";
import { FrontMatterCache, Loc, SectionCache } from "obsidian";
import path from "path";

import { NotesPublisherSettings } from "./settings.js";

export interface FrontMatterConfig {
	date: string,
	draft: string,
	title: string,
}

// section types with visual line breaks in Obsidian
const HARD_BREAK_SECTION_TYPES = new Set(['blockquote', 'callout', 'list', 'paragraph']);

// subset of SectionCache, position are relative to the body (without frontmatter)
export type BodySection = { type: string, position: { start: { line: number }, end: { line: number } } };

export function buildConverter(
	fm: FrontMatterCache,
	data: string,
	frontmatterEnd: Loc,
	fallbackTitle: string,
	settings: NotesPublisherSettings,
	sections: SectionCache[] = [],
): { title: string, section: string, converter: NoteConverter } {
	const title: string = fm[settings.fmTitle] ?? fallbackTitle;
	const body = data.slice(frontmatterEnd.offset).replace(/^\n/, '');
	const section = fm[settings.fmSection] ?? settings.defaultSection;

	const bodyStartLine = frontmatterEnd.line + 1;
	const bodySections: BodySection[] = sections.map((s) => ({
		type: s.type,
		position: {
			start: { line: s.position.start.line - bodyStartLine },
			end: { line: s.position.end.line - bodyStartLine },
		},
	}));

	const converter = new NoteConverter(title, {
		date: settings.fmDate,
		draft: settings.fmDraft,
		title: settings.fmTitle,
	});
	converter.convert(fm, body, bodySections);

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

	convert(fm: FrontMatterCache, content: string, sections: BodySection[] = []) {
		this.processFrontMatter(fm);
		this.processContent(content, sections);
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

	private processContent(content: string, sections: BodySection[]) {
		const processed = content
			// embedded image
			.replace(
				/!\[\[([^|\]]+\.(?:jpe?g|png|gif|svg))\|([^\]]+)\]\]/g,
				'![$2]($1)'
			);

		const sectionOfLine = (line: number) =>
			sections.find((s) => s.position.start.line <= line && line <= s.position.end.line);

		// translate visual line breaks to hard breaks for CommonMark
		const lines = processed.split('\n');
		this.convertedContent = lines
			.map((line, i) => {
				const next = lines[i + 1];
				if (line === '' || next === undefined || next === '')
					return line;

				const section = sectionOfLine(i);
				if (!section || !HARD_BREAK_SECTION_TYPES.has(section.type) || section !== sectionOfLine(i + 1))
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

