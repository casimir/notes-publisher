import { describe, expect, it } from "vitest";
import { compareTerm, FilterTerm, PredicateParser } from "./filter.js";

interface Case {
	name: string;
	input: string;
	expect: FilterTerm[] | { error: RegExp };
}

const cases: Case[] = [
	{ name: "empty input", input: "", expect: [] },
	{ name: "whitespace-only input", input: "   ", expect: [] },
	{
		name: "single term",
		input: "draft:false",
		expect: [{ key: "draft", value: "false", negated: false }],
	},
	{
		name: "two terms",
		input: "draft:false section:posts",
		expect: [
			{ key: "draft", value: "false", negated: false },
			{ key: "section", value: "posts", negated: false },
		],
	},
	{
		name: "tolerates surrounding and between whitespace",
		input: "  draft:false   section:posts  ",
		expect: [
			{ key: "draft", value: "false", negated: false },
			{ key: "section", value: "posts", negated: false },
		],
	},
	{
		name: "key with underscore",
		input: "front_matter:posts",
		expect: [{ key: "front_matter", value: "posts", negated: false }],
	},
	{
		name: "key with dash",
		input: "front-matter:posts",
		expect: [{ key: "front-matter", value: "posts", negated: false }],
	},
	{
		name: "unquoted value keeps wikilink syntax",
		input: "categories:[[Posts]]",
		expect: [{ key: "categories", value: "[[Posts]]", negated: false }],
	},
	{
		name: "double-quoted value with a space",
		input: 'title:"hello world"',
		expect: [{ key: "title", value: "hello world", negated: false }],
	},
	{
		name: "single-quoted value with a space",
		input: "title:'hello world'",
		expect: [{ key: "title", value: "hello world", negated: false }],
	},
	{
		name: "quoted term followed by a bare term",
		input: 'title:"a" draft:false',
		expect: [
			{ key: "title", value: "a", negated: false },
			{ key: "draft", value: "false", negated: false },
		],
	},
	{
		name: "escaped enclosing quote does not close the value",
		input: 'title:"say \\"hi\\""',
		expect: [{ key: "title", value: 'say "hi"', negated: false }],
	},
	{
		name: "escaped enclosing quote in a single-quoted value",
		input: "title:'don\\'t'",
		expect: [{ key: "title", value: "don't", negated: false }],
	},
	{
		name: "escaped backslash",
		input: 'title:"back\\\\slash"',
		expect: [{ key: "title", value: "back\\slash", negated: false }],
	},
	{
		name: "trailing escaped backslash still closes the quote",
		input: 'title:"ends with \\\\"',
		expect: [{ key: "title", value: "ends with \\", negated: false }],
	},
	{
		name: "unknown escape sequence stays literal",
		input: 'title:"a \\n b"',
		expect: [{ key: "title", value: "a \\n b", negated: false }],
	},
	{
		name: "unescaped backslash before non-quote char is literal",
		input: 'path:"C:\\notes"',
		expect: [{ key: "path", value: "C:\\notes", negated: false }],
	},
	{
		name: "other quote char needs no escaping inside",
		input: "title:'say \"hi\"'",
		expect: [{ key: "title", value: 'say "hi"', negated: false }],
	},
	{
		name: "escaped closing quote leaves the value unterminated",
		input: 'title:"a\\"',
		expect: { error: /./ },
	},
	{
		name: "missing colon",
		input: "draft",
		expect: { error: /invalid key/ },
	},
	{
		name: "missing value",
		input: "draft:",
		expect: { error: /missing value/ },
	},
	{
		name: "unterminated quoted value",
		input: 'title:"unterminated',
		expect: { error: /./ },
	},
	{
		name: "unary operator negates the term",
		input: "-draft:false",
		expect: [{ key: "draft", value: "false", negated: true }],
	},
	{
		name: "negated term mixed with a plain term",
		input: "-draft:false section:posts",
		expect: [
			{ key: "draft", value: "false", negated: true },
			{ key: "section", value: "posts", negated: false },
		],
	},
	{
		name: "negated quoted value",
		input: '-title:"hello world"',
		expect: [{ key: "title", value: "hello world", negated: true }],
	},
	{
		name: "space between the negation operator and the key is invalid",
		input: "- draft:false",
		expect: { error: /invalid key/ },
	},
	{
		name: "double negation is invalid",
		input: "--draft:false",
		expect: { error: /invalid key/ },
	},
];

describe("PredicateParser", () => {
	it.each(cases)("$name", ({ input, expect: expected }) => {
		const run = () => new PredicateParser(input).parse();

		if (Array.isArray(expected)) {
			expect(run()).toEqual(expected);
		} else {
			expect(run).toThrow(expected.error);
		}
	});
});

interface CompareCase {
	name: string;
	term: FilterTerm;
	value: unknown;
	expect: boolean | { error: RegExp };
}

const compareCases: CompareCase[] = [
	{ name: "string equal", term: { key: "k", value: "posts", negated: false }, value: "posts", expect: true },
	{ name: "string unequal", term: { key: "k", value: "posts", negated: false }, value: "notes", expect: false },
	{ name: "number loosely equal to string", term: { key: "k", value: "1", negated: false }, value: 1, expect: true },
	{ name: "boolean loosely equal to string", term: { key: "k", value: "true", negated: false }, value: true, expect: true },
	{ name: "array matches when any element equals", term: { key: "k", value: "posts", negated: false }, value: ["notes", "posts"], expect: true },
	{ name: "array mismatches when no element equals", term: { key: "k", value: "posts", negated: false }, value: ["notes", "drafts"], expect: false },
	{ name: "negated term flips a match", term: { key: "k", value: "posts", negated: true }, value: "posts", expect: false },
	{ name: "negated term flips a mismatch", term: { key: "k", value: "posts", negated: true }, value: "notes", expect: true },
	{ name: "unknown value type throws", term: { key: "k", value: "x", negated: false }, value: { nested: true }, expect: { error: /unknown value type/ } },
];

describe("compareTerm", () => {
	it.each(compareCases)("$name", ({ term, value, expect: expected }) => {
		const run = () => compareTerm(term, value);

		if (typeof expected === "boolean") {
			expect(run()).toBe(expected);
		} else {
			expect(run).toThrow(expected.error);
		}
	});
});
