import {
	Command,
	Notice,
	Platform,
	Plugin
} from 'obsidian';

import {
	DEFAULT_SETTINGS,
	NotesPublisherSettings,
	NotesPublisherSettingsTab
} from './settings.js';
import { NotesSyncer } from './syncer.js';
import { PublishModal } from './ui/publish-modal.js';


const CMD_LABEL_PUBLISH = 'Publish notes to the server'

export enum Switch { on, off, toggle }

export default class NotesPublisher extends Plugin {
	private diskSyncStatusItem!: HTMLElement;

	settings!: NotesPublisherSettings;
	syncer!: NotesSyncer;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NotesPublisherSettingsTab(this.app, this));

		this.syncer = new NotesSyncer(this.settings, this.app.fileManager.processFrontMatter);
		this.registerEvent(this.app.vault.on("create", EN(this.syncer.onFileCreate)));
		this.registerEvent(this.app.vault.on("delete", EN(this.syncer.onFileDelete)));
		this.registerEvent(this.app.vault.on("modify", EN(this.syncer.onFileUpdate)));
		this.registerEvent(this.app.metadataCache.on("changed", EN(this.syncer.onNoteUpdate)));


		const publishCommand: Command = {
			id: 'publish',
			name: CMD_LABEL_PUBLISH,
			callback: () => this.publishToServer()
		};


		// TODO update icon
		this.addRibbonIcon('dice', CMD_LABEL_PUBLISH, (_evt: MouseEvent) => {
			publishCommand.callback!();
		});

		this.addCommand(publishCommand);
		if (Platform.isDesktopApp) {
			this.addCommand({
				id: 'toggle-disksync',
				name: 'Toggle disk synchronisation',
				callback: async () => {
					await this.switchDiskSync(Switch.toggle);
				},
			});
		}

		this.diskSyncStatusItem = this.addStatusBarItem();
		this.diskSyncStatusItem.onClickEvent((_evt: MouseEvent) => {
			this.switchDiskSync(Switch.toggle);
		})
		this.updateStatusBar();
	}

	onunload() { }

	private updateStatusBar() {
		// TODO use an icon instead?
		this.diskSyncStatusItem.setText(this.syncer.enabled ? 'Syncing...' : 'Not Syncing');
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<NotesPublisherSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async switchDiskSync(value: Switch) {
		switch (value) {
			case Switch.on:
				this.syncer.enabled = true;
				break;
			case Switch.off:
				this.syncer.enabled = false;
				break;
			case Switch.toggle:
				this.syncer.enabled = !this.syncer.enabled;
				break;
		}

		if (this.syncer.enabled) {
			await this.syncer.reset();
			await Promise.all(this.app.vault.getMarkdownFiles().map(async (file) => {
				const cache = this.app.metadataCache.getFileCache(file)!;
				const content = await this.app.vault.cachedRead(file);
				this.syncer.onNoteUpdate(file, content, cache);
			}));
		}

		this.updateStatusBar();
	}

	publishToServer() {
		new PublishModal(this.app, this.settings).open();
	}
}

export function EN<TFunc extends (...args: any[]) => any>(func: TFunc): (...args: Parameters<TFunc>) => ReturnType<TFunc> {
	const notifyError = (e: unknown) => {
		const message = e instanceof Error ? e.message : 'unknown error';
		new Notice('Publisher: ' + message, 400);
	};
	return (...args: Parameters<TFunc>) => {
		try {
			const result = func(...args);
			if (result instanceof Promise) result.catch(notifyError);
			return result;
		} catch (e) {
			notifyError(e);
		}
	};
}
