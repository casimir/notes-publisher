import { App, FrontMatterCache } from "obsidian";

const QUOTES = ["'", '"']

interface ParsedString {
	parsed: string
	sourceLength: number
}

/**
 * Parses the string that start at the beginning for `text`. A string here is either
 * quoted or whitespace delimited. This function return the length of text it consumed
 * to parse the string completly.
 */
function parseNextString(text: string): ParsedString {
	const quote = text[0];
	if (quote === undefined)
		return { parsed: '', sourceLength: 0 };

	if (!QUOTES.includes(quote)) {
		const parsed = text.match(/^(\S+)/)![0];
		return { parsed, sourceLength: parsed.length };
	}

	let parsed = '';
	let cursor = 1;
	while (cursor < text.length) {
		const current = text[cursor];
		const next = text[cursor + 1];
		if (current === '\\' && (next === quote || next === '\\')) {
			parsed += next;
			cursor += 2;
			continue;
		}
		if (current === quote) {
			cursor++;
			return { parsed, sourceLength: cursor };
		}
		parsed += current;
		cursor++;
	}
	throw new Error(`unterminated quoted value: ${text}`);
}

export interface FilterTerm {
	key: string
	value: string
	negated: boolean
}

function dynamicEquals(stringed: string, value: unknown): boolean {
	if (Array.isArray(value))
		return value.some((it) => dynamicEquals(stringed, it));

	switch (typeof value) {
		case 'boolean':
			return (stringed === 'true') === value;
		case 'number':
			return Number(stringed) === value;
		case 'string':
			return stringed === value;
		default:
			throw new Error(`unknown value type: ${String(value)}`);
	}
}

export function compareTerm(term: FilterTerm, value: unknown) {
	if (value === undefined)
		return false;

	let result = dynamicEquals(term.value, value);
	return term.negated ? !result : result;
}

type FilterPredicate = FilterTerm[];

export class PredicateParser {
	text: string
	private offset: number
	private predicate: FilterPredicate

	constructor(text: string) {
		this.text = text;
		this.offset = 0;
		this.predicate = [];
	}

	private offsettedText() {
		return this.text.substring(this.offset);
	}

	private consumeWhitespaces() {
		const match = this.offsettedText().match(/^(\s*)/);
		if (match) {
			this.offset += match[1]!.length;
		}
	}

	private consumeTerm(): FilterTerm {
		const negated = this.offsettedText()[0] === '-';
		if (negated) {
			this.offset++;
		}

		const keyMatch = this.offsettedText().match(/^(\w[\w\d-_]+):/);
		if (!keyMatch)
			throw new Error(`invalid key at ${this.offset}: ${this.offsettedText()}`);
		const key = keyMatch[1]!;
		this.offset += key.length + 1;

		const { parsed, sourceLength } = parseNextString(this.offsettedText());
		if (!parsed)
			throw new Error(`missing value for key ${key}`);
		this.offset += sourceLength;
		return { key, value: parsed, negated };
	}

	parse(): FilterPredicate {
		while (this.offset < this.text.length) {
			this.consumeWhitespaces();
			if (this.offset >= this.text.length) break;
			this.predicate.push(this.consumeTerm());
		}
		return this.predicate;
	}
}

export class NoteFilter {
	private terms: FilterPredicate;

	constructor(predicate: string) {
		this.terms = new PredicateParser(predicate).parse();
	}

	matches(fm: FrontMatterCache | undefined): boolean {
		if (!fm) return false;

		for (const it of this.terms) {
			if (!compareTerm(it, fm[it.key]))
				return false;
		}
		return true;
	}
}

export function filterAllNotes(app: App, predicate: string) {
	const filter = new NoteFilter(predicate)
	return app.vault.getMarkdownFiles()
		.filter((f) => filter.matches(app.metadataCache.getFileCache(f)?.frontmatter));
}
