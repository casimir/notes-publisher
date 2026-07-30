import { App, ButtonComponent, Modal, Notice, setIcon } from 'obsidian';

import { collectFiles, Publisher } from '../publisher.js';
import { NotesPublisherSettings } from '../settings.js';
import { renderDiffInto } from './diff.js';

export class PublishModal extends Modal {
	private settings: NotesPublisherSettings;

	constructor(app: App, settings: NotesPublisherSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen() {
		this.setTitle('Publish notes');
		this.renderIdle();
	}

	onClose() {
		this.contentEl.empty();
	}

	private renderIdle() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv({ cls: 'np-idle-container' });
		new ButtonComponent(container)
			.setButtonText('Publish')
			.setCta()
			.onClick(() => this.run());
	}

	private renderBusy() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv({ cls: 'np-idle-container' });
		const icon = container.createSpan({ cls: 'np-spin' });
		setIcon(icon, 'loader-2');
		container.createSpan({ text: 'Publishing…' });
	}

	private renderError(e: Error) {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', { text: `Failed to publish notes: ${e.message}` });
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons)
			.setButtonText('Retry')
			.setCta()
			.onClick(() => this.renderIdle());
	}

	private renderDiff(id: string, diff: string) {
		const { contentEl } = this;
		contentEl.empty();

		if (!diff) {
			contentEl.createEl('p', { text: 'No changes to publish.' });
			const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
			new ButtonComponent(buttons)
				.setButtonText('Close')
				.onClick(() => this.close());
			return;
		}

		renderDiffInto(contentEl, diff);

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const confirmButton = new ButtonComponent(buttons)
			.setButtonText('Confirm')
			.setCta()
			.onClick(async () => {
				confirmButton.setDisabled(true);
				const publisher = new Publisher(this.settings.publisherUrl, this.settings.publisherToken);
				try {
					await publisher.confirm(id);
					new Notice('Notes published.');
					this.close();
				} catch (e) {
					this.renderError(e as Error);
				}
			});
	}

	private async run() {
		this.renderBusy();
		const publisher = new Publisher(this.settings.publisherUrl, this.settings.publisherToken);
		try {
			const files = await collectFiles(this.app, this.settings);
			const resp = await publisher.publish(files);
			this.renderDiff(resp.id, resp.diff);
		} catch (e) {
			this.renderError(e as Error);
		}
	}
}
