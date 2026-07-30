import { promises as fs } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrontMatterConfig, NoteConverter } from "./converter.js";

const fmConfig: FrontMatterConfig = {
	date: "created",
	draft: "draft",
	title: "np-title",
};

interface Case {
	name: string;
	title: string;
	input: { frontmatter: Record<string, unknown>; content: string };
	expect: { content: string };
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
		converter.convert(input.frontmatter as never, input.content);

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
