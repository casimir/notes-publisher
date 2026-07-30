import { promises as fs } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BodySection, FrontMatterConfig, NoteConverter } from "./converter.js";

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
		name: "converts image embeds to CommonMark, leaves prose and bare wikilinks untouched",
		title: "Some title",
		input: {
			frontmatter: {},
			content:
				"Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n" +
				"![[dolor.png|Sed do eiusmod tempor]]\n\n" +
				"See also [[Ut enim ad minim]] for the flip side.\n\n" +
				"![[sit.svg|Quis nostrud exercitation]]",
			sections: [
				section("paragraph", 0),
				section("paragraph", 2),
				section("paragraph", 4),
				section("paragraph", 6),
			],
		},
		expect: {
			content:
				"---\ntitle: Some title\n---\n\n" +
				"Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n" +
				"![Sed do eiusmod tempor](dolor.png)\n\n" +
				"See also [[Ut enim ad minim]] for the flip side.\n\n" +
				"![Quis nostrud exercitation](sit.svg)",
		},
	},
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
		name: "does not add a hard break between an embedded image and a quoted caption line",
		title: "Some title",
		input: {
			frontmatter: {},
			content: "![[dolor.png|alt text]]\n> A caption right below the image.",
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
