import { describe, expect, it } from "vitest";
import { lineKind } from "./diff.js";

describe("lineKind", () => {
	it("classifies +++/--- headers, not add/del", () => {
		expect(lineKind("+++ b/note.md")).toBe("header");
		expect(lineKind("--- a/note.md")).toBe("header");
	});

	it("classifies hunk headers", () => {
		expect(lineKind("@@ -1,2 +1,3 @@")).toBe("header");
	});

	it("classifies add and del lines", () => {
		expect(lineKind("+new line")).toBe("add");
		expect(lineKind("-old line")).toBe("del");
	});

	it("classifies context lines", () => {
		expect(lineKind(" unchanged line")).toBe("context");
		expect(lineKind("")).toBe("context");
	});
});
