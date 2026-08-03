import { promises as fs } from "fs";
import { App, CachedMetadata, EmbedCache, FrontMatterCache, TFile } from "obsidian";
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

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg']);

function rewriteEmbedImages(data: string, embeds: EmbedCache[]): { data: string, attachments: string[] } {
	const attachments: string[] = [];
	const byOffsetDesc = [...embeds].sort((a, b) => b.position.start.offset - a.position.start.offset);

	let result = data;
	for (const embed of byOffsetDesc) {
		const ext = path.extname(embed.link).toLowerCase();
		if (!IMAGE_EXTENSIONS.has(ext)) continue;

		if (!attachments.includes(embed.link)) attachments.unshift(embed.link);

		const alt = embed.displayText && embed.displayText !== embed.link ? embed.displayText : '';
		const replacement = `![${alt}](${embed.link})`;
		result = result.slice(0, embed.position.start.offset) + replacement + result.slice(embed.position.end.offset);
	}

	return { data: result, attachments };
}

export interface ResolvedAttachment {
	link: string
	file: TFile
}

// resolves embed links to vault files, wrap obsidian resolver
export function resolveAttachments(app: App, links: string[], sourcePath: string): ResolvedAttachment[] {
	return links
		.map((link) => ({ link, file: app.metadataCache.getFirstLinkpathDest(link, sourcePath) }))
		.filter((r): r is ResolvedAttachment => r.file !== null);
}

export function buildConverter(
	cache: CachedMetadata,
	data: string,
	fallbackTitle: string,
	settings: NotesPublisherSettings,
): { title: string, section: string, converter: NoteConverter } {
	if (!cache.frontmatter || !cache.frontmatterPosition)
		throw new Error('buildConverter requires a note with frontmatter');
	const fm = cache.frontmatter;
	const frontmatterEnd = cache.frontmatterPosition.end;

	const title: string = fm[settings.fmTitle] ?? fallbackTitle;
	const section = fm[settings.fmSection] ?? settings.defaultSection;

	const { data: rewritten, attachments } = rewriteEmbedImages(data, cache.embeds ?? []);
	const body = rewritten.slice(frontmatterEnd.offset).replace(/^\n/, '');
	const bodyStartLine = frontmatterEnd.line + 1;
	const bodySections: BodySection[] = (cache.sections ?? []).map((s) => ({
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
	converter.convert(fm, body, bodySections, attachments);

	return { title, section, converter };
}

export class NoteConverter {
	private noteTitle: string;
	private fmConfig: FrontMatterConfig;

	private convertedFm: [string, string][] | undefined;
	private convertedContent: string | undefined;

	attachments: string[] = [];

	constructor(title: string, fmConfig: FrontMatterConfig) {
		this.noteTitle = title;
		this.fmConfig = fmConfig;
	}

	convert(fm: FrontMatterCache, content: string, sections: BodySection[] = [], attachments: string[] = []) {
		this.attachments = attachments;
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
		const sectionOfLine = (line: number) =>
			sections.find((s) => s.position.start.line <= line && line <= s.position.end.line);

		// translate visual line breaks to hard breaks for CommonMark
		const lines = content.split('\n');
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

