import { promises as fs } from "fs";
import { App, CachedMetadata, EmbedCache, FrontMatterCache, TFile } from "obsidian";
import path from "path";

function extname(filePath: string): string {
	const base = filePath.slice(filePath.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot) : '';
}

import { NotesPublisherSettings } from "./settings.js";


// section types with visual line breaks in Obsidian
const HARD_BREAK_SECTION_TYPES = new Set(['blockquote', 'callout', 'list', 'paragraph']);

// hugo-notice style for each Obsidian callout type alias, falls back to 'note'
const NOTICE_STYLES: Record<string, string> = {
	warning: 'warning', danger: 'warning', error: 'warning', caution: 'warning',
	attention: 'warning', failure: 'warning', fail: 'warning', missing: 'warning', bug: 'warning',
	tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
	info: 'info', todo: 'info', question: 'info', help: 'info', faq: 'info',
	note: 'note',
};

const CALLOUT_HEAD = /^>\s*\[!(\w+)\][-+]?\s*(.*)$/;
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg']);
const WIKILINK = /^\[\[([^\]|#]+)[^\]]*\]\]$/;

export interface FrontMatterConfig {
	date: string,
	draft: string,
	title: string,
	tags: string,
}

// subset of SectionCache, position are relative to the body (without frontmatter)
export type BodySection = { type: string, position: { start: { line: number }, end: { line: number } } };


function rewriteEmbedImages(data: string, embeds: EmbedCache[]): { data: string, attachments: string[] } {
	const attachments: string[] = [];
	const byOffsetDesc = [...embeds].sort((a, b) => b.position.start.offset - a.position.start.offset);

	let result = data;
	for (const embed of byOffsetDesc) {
		const ext = extname(embed.link).toLowerCase();
		if (!IMAGE_EXTENSIONS.has(ext)) continue;

		if (!attachments.includes(embed.link)) attachments.unshift(embed.link);

		const alt = embed.displayText && embed.displayText !== embed.link ? embed.displayText : '';
		const replacement = `![${alt}](${embed.link})`;
		result = result.slice(0, embed.position.start.offset) + replacement + result.slice(embed.position.end.offset);
	}

	return { data: result, attachments };
}

function stripWikilink(value: string): string {
	return (value.match(WIKILINK)?.[1] ?? value).trim();
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

	const title = (fm[settings.fmTitle] as string | undefined) ?? fallbackTitle;
	const section = (fm[settings.fmSection] as string | undefined) ?? settings.defaultSection;

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
		tags: settings.fmTags,
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
			const date = fm[this.fmConfig.date] as string;
			this.convertedFm.push(['date', date]);
		}

		if (this.fmConfig.draft in fm) {
			const value = fm[this.fmConfig.draft] as boolean;
			this.convertedFm.push(['draft', value.toString()]);
		}

		if (this.fmConfig.tags in fm) {
			const raw = fm[this.fmConfig.tags] as unknown;
			const values: string[] = Array.isArray(raw) ? raw as string[] : [raw as string];
			const names = values.map(stripWikilink).filter((n) => n !== '');
			if (names.length > 0)
				this.convertedFm.push(['tags', `[${names.map((n) => JSON.stringify(n)).join(', ')}]`]);
		}
	}

	private processContent(content: string, sections: BodySection[]) {
		const sectionOfLine = (line: number) =>
			sections.find((s) => s.position.start.line <= line && line <= s.position.end.line);

		// translate visual line breaks to hard breaks for CommonMark
		const lines = content.split('\n');
		const withHardBreaks = lines.map((line, i) => {
			const next = lines[i + 1];
			if (line === '' || next === undefined || next === '')
				return line;

			const section = sectionOfLine(i);
			if (!section || !HARD_BREAK_SECTION_TYPES.has(section.type) || section !== sectionOfLine(i + 1))
				return line;

			return line + '  ';
		});

		this.convertedContent = this.rewriteCallouts(withHardBreaks, sections).join('\n');
	}

	private rewriteCallouts(lines: string[], sections: BodySection[]): string[] {
		const result: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? '';
			const section = sections.find((s) => s.type === 'callout' && s.position.start.line === i);
			const head = section && line.match(CALLOUT_HEAD);
			if (!section || !head) {
				result.push(line);
				continue;
			}

			const style = NOTICE_STYLES[head[1]!.toLowerCase()] ?? 'note';
			const title = head[2]!.trim();
			result.push(title ? `{{< notice ${style} ${JSON.stringify(title)} >}}` : `{{< notice ${style} >}}`);

			for (i++; i <= section.position.end.line; i++)
				result.push((lines[i] ?? '').replace(/^>\s?/, ''));
			result.push('{{< /notice >}}');
			i--;
		}
		return result;
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

