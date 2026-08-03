import { promises as fs } from "fs";
import { CachedMetadata, EmbedCache, Loc } from "obsidian";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BodySection, buildConverter, FrontMatterConfig, NoteConverter } from "./converter.js";
import { DEFAULT_SETTINGS as settings } from "./settings.js";

const fmConfig: FrontMatterConfig = {
	date: "created",
	draft: "draft",
	title: "np-title",
};

interface Case {
	name: string;
	title: string;
	input: { frontmatter: Record<string, unknown>; content: string; sections?: BodySection[] };
	expect: { content: string };
}

function section(type: string, startLine: number, endLine = startLine) {
	return { type, position: { start: { line: startLine }, end: { line: endLine } } };
}

const cases: Case[] = [
	{
		name: "appends hard-break spaces to intra-paragraph newlines, not to blank-line breaks or fenced code",
		title: "Some title",
		input: {
			frontmatter: {},
			content:
				"Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\nSed do eiusmod tempor.\n\n" +
				"Ut enim ad minim veniam.\n\n" +
				"```\nline one\nline two\n```",
			sections: [
				section("paragraph", 0, 2),
				section("paragraph", 4),
				section("code", 6, 9),
			],
		},
		expect: {
			content:
				"---\ntitle: Some title\n---\n\n" +
				"Lorem ipsum dolor sit amet.  \nConsectetur adipiscing elit.  \nSed do eiusmod tempor.\n\n" +
				"Ut enim ad minim veniam.\n\n" +
				"```\nline one\nline two\n```",
		},
	},
	{
		name: "does not add a hard break between an image and a quoted caption line",
		title: "Some title",
		input: {
			frontmatter: {},
			content: "![alt text](dolor.png)\n> A caption right below the image.",
			sections: [
				section("paragraph", 0),
				section("blockquote", 1),
			],
		},
		expect: {
			content:
				"---\ntitle: Some title\n---\n\n" +
				"![alt text](dolor.png)\n> A caption right below the image.",
		},
	},
	{
		name: "appends hard-break spaces between consecutive lines of the same blockquote",
		title: "Some title",
		input: {
			frontmatter: {},
			content: "> line one\n> line two\n\n> second quote",
			sections: [
				section("blockquote", 0, 1),
				section("blockquote", 3),
			],
		},
		expect: {
			content:
				"---\ntitle: Some title\n---\n\n" +
				"> line one  \n> line two\n\n> second quote",
		},
	},
	{
		name: "maps date and draft frontmatter",
		title: "Lorem ipsum",
		input: {
			frontmatter: { created: "2024-01-15", draft: true },
			content: "Lorem ipsum dolor sit amet",
		},
		expect: {
			content: "---\ntitle: Lorem ipsum\ndate: 2024-01-15\ndraft: true\n---\n\nLorem ipsum dolor sit amet",
		},
	},
];

describe("NoteConverter", () => {
	const writeFile = vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
	const mkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);

	beforeEach(() => {
		writeFile.mockClear();
		mkdir.mockClear();
	});

	it.each(cases)("$name", ({ title, input, expect: expected }) => {
		const converter = new NoteConverter(title, fmConfig);
		converter.convert(input.frontmatter as never, input.content, input.sections ?? []);

		expect(converter.toCommonMark()).toBe(expected.content);
	});

	it("writeInto writes the rendered markdown to <dir>/index.md", async () => {
		const converter = new NoteConverter("Some title", fmConfig);
		converter.convert({}, "Lorem ipsum");

		await converter.writeInto("/out");

		expect(writeFile).toHaveBeenCalledOnce();
		expect(writeFile).toHaveBeenCalledWith(join("/out", "index.md"), converter.toCommonMark(), "utf-8");
	});
});

const FRONTMATTER = "---\n---\n";
const FRONTMATTER_END: Loc = { line: 1, col: 3, offset: FRONTMATTER.length };

// finds each raw embed in `data` in order, so duplicate raw text resolves to distinct offsets
function embedsIn(data: string, specs: { raw: string; link: string; displayText?: string }[]): EmbedCache[] {
	let cursor = 0;
	return specs.map(({ raw, link, displayText }) => {
		const offset = data.indexOf(raw, cursor);
		cursor = offset + raw.length;
		return {
			link,
			displayText,
			original: raw,
			position: {
				start: { line: 0, col: 0, offset },
				end: { line: 0, col: 0, offset: offset + raw.length },
			},
		};
	});
}

const cacheWith = (embeds: EmbedCache[]) =>
	({ frontmatter: {}, frontmatterPosition: { start: FRONTMATTER_END, end: FRONTMATTER_END }, embeds }) as CachedMetadata;

describe("buildConverter attachments", () => {
	it("rewrites embeds to CommonMark images, leaves note embeds untouched", () => {
		const body =
			"Lorem ipsum.\n\n![[dolor.png|Sed do eiusmod]]\n\nSee also [[Ut enim ad minim]] for the flip side.";
		const data = FRONTMATTER + body;
		const embeds = embedsIn(data, [
			{ raw: "![[dolor.png|Sed do eiusmod]]", link: "dolor.png", displayText: "Sed do eiusmod" },
		]);

		const { converter } = buildConverter(cacheWith(embeds), data, "fallback", settings);

		expect(converter.toCommonMark()).toBe(
			"---\ntitle: fallback\n---\n\n" +
			"Lorem ipsum.\n\n![Sed do eiusmod](dolor.png)\n\nSee also [[Ut enim ad minim]] for the flip side."
		);
		expect(converter.attachments).toEqual(["dolor.png"]);
	});

	it("keeps an empty alt for a no-alt embed", () => {
		const body = "![[dolor.png]]";
		const data = FRONTMATTER + body;
		const embeds = embedsIn(data, [{ raw: "![[dolor.png]]", link: "dolor.png" }]);

		const { converter } = buildConverter(cacheWith(embeds), data, "fallback", settings);

		expect(converter.toCommonMark()).toBe("---\ntitle: fallback\n---\n\n![](dolor.png)");
	});

	it("keeps a nested-path embed's link as the bundle-relative path", () => {
		const body = "![[attachments/nested/img.jpg|Nested]]";
		const data = FRONTMATTER + body;
		const embeds = embedsIn(data, [
			{ raw: "![[attachments/nested/img.jpg|Nested]]", link: "attachments/nested/img.jpg", displayText: "Nested" },
		]);

		const { converter } = buildConverter(cacheWith(embeds), data, "fallback", settings);

		expect(converter.toCommonMark()).toBe("---\ntitle: fallback\n---\n\n![Nested](attachments/nested/img.jpg)");
		expect(converter.attachments).toEqual(["attachments/nested/img.jpg"]);
	});

	it("dedupes an attachment embedded more than once", () => {
		const body = "![[dolor.png|first]]\n\n![[dolor.png|second]]";
		const data = FRONTMATTER + body;
		const embeds = embedsIn(data, [
			{ raw: "![[dolor.png|first]]", link: "dolor.png", displayText: "first" },
			{ raw: "![[dolor.png|second]]", link: "dolor.png", displayText: "second" },
		]);

		const { converter } = buildConverter(cacheWith(embeds), data, "fallback", settings);

		expect(converter.attachments).toEqual(["dolor.png"]);
	});
});
