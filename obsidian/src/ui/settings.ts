import { App, debounce, Platform, PluginSettingTab, Setting, SettingGroup } from 'obsidian';

import { filterAllNotes } from '../filter.js';
import NotesPublisher, { Switch } from '../main.js';
import { DEFAULT_SETTINGS } from '../settings.js';

export class NotesPublisherSettingsTab extends PluginSettingTab {
	plugin: NotesPublisher;

	constructor(app: App, plugin: NotesPublisher) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new SettingGroup(containerEl)
			.setHeading('Remote synchronisation')
			.addSetting((setting) => { setting
				.setName('Publisher URL')
				.setDesc('Base URL of the publisher service.')
				.addText((text) => text
					.setPlaceholder('https://...')
					.setValue(this.plugin.settings.publisherUrl)
					.onChange((value) => void (async () => {
						this.plugin.settings.publisherUrl = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Publisher token')
				.setDesc('Secret token to use with publisher service.')
				// SecretsStorage would have been nice but it doesn't sync between devices
				.addText((text) => text
					.setPlaceholder('secret-token')
					.setValue(this.plugin.settings.publisherToken)
					.onChange((value) => void (async () => {
						this.plugin.settings.publisherToken = value;
						await this.plugin.saveSettings();
					})())
				);
			});

		if (Platform.isDesktopApp) {
			new SettingGroup(containerEl)
				.setHeading('Disk synchronisation')
				.addSetting((setting) => { setting
					.setName('Synchronize to disk')
					.setDesc('Copy updates to disk automatically.')
					.addToggle((toggle) => toggle
						.setValue(this.plugin.syncer.enabled)
						.onChange((value) => {
							void this.plugin.switchDiskSync(value ? Switch.on : Switch.off);
						})
					);
				})
				.addSetting((setting) => { setting
					.setName('Disk destination')
					.setDesc('Path where to put processed files on disk.')
					.addText((text) => text
						.setPlaceholder('~/some/where/there/')
						.setValue(this.plugin.settings.diskDestination)
						.onChange((value) => void (async () => {
							this.plugin.settings.diskDestination = value;
							await this.plugin.saveSettings();
						})())
					);
				});
		}

		const recountMatches = debounce((setting: Setting, value: string) => {
			try {
				const matches = filterAllNotes(this.app, value);
				setting.setDesc(`Matches ${matches.length} notes`);
			} catch (e) {
				setting.setDesc(`Invalid query: ${(e as Error).message}`);
			}
		}, 250);

		new SettingGroup(containerEl)
			.addSetting((setting) => { setting
				.setName('Notes filter')
				.setDesc('Filtering rules to choose which notes to sync')
				.addText((text) => text
					.setValue(this.plugin.settings.notesFilter)
					.onChange((value) => void (async () => {
						this.plugin.settings.notesFilter = value;
						await this.plugin.saveSettings();
						recountMatches(setting, value);
					})())
				);
			});

		new SettingGroup(containerEl)
			.setHeading('Frontmatter mappings')
			.addSetting((setting) => { setting
				.setName('Date attribute')
				.setDesc('Date of the note.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmDate)
					.setValue(this.plugin.settings.fmDate)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmDate = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Draft state attribute')
				.setDesc('Boolean flag to determine if the note is ready to be published.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmDraft)
					.setValue(this.plugin.settings.fmDraft)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmDraft = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Title attribute')
				.setDesc('Override for the title to use instead of the note Obsidian title.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmTitle)
					.setValue(this.plugin.settings.fmTitle)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmTitle = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Slug attribute')
				.setDesc('Override for the published note slug.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmSlug)
					.setValue(this.plugin.settings.fmSlug)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmSlug = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Section attribute')
				.setDesc('Override for the published note section.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmSection)
					.setValue(this.plugin.settings.fmSection)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmSection = value;
						await this.plugin.saveSettings();
					})())
				);
			})
			.addSetting((setting) => { setting
				.setName('Topics attribute')
				.setDesc('Tags for the published article. Note links are converted to plain text.')
				.addText((text) => text
					.setPlaceholder(DEFAULT_SETTINGS.fmTags)
					.setValue(this.plugin.settings.fmTags)
					.onChange((value) => void (async () => {
						this.plugin.settings.fmTags = value;
						await this.plugin.saveSettings();
					})())
				);
			});
	}
}
