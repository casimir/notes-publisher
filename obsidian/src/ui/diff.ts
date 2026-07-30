export function lineKind(line: string): 'header' | 'add' | 'del' | 'context' {
	if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@'))
		return 'header';
	if (line.startsWith('+'))
		return 'add';
	if (line.startsWith('-'))
		return 'del';
	return 'context';
}

export function renderDiffInto(parent: HTMLElement, diff: string) {
	const pre = parent.createEl('pre', { cls: 'np-diff' });
	for (const line of diff.split('\n')) {
		pre.createSpan({ text: line + '\n', cls: 'np-diff-' + lineKind(line) });
	}
}
