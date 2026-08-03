export interface NotesPublisherSettings {
	// Remote synchronisation

	publisherUrl: string;
	publisherToken: string;

	// Disk synchronisation

	diskDestination: string,

	// Post selection and mapping

	notesFilter: string,
	defaultSection: string,

	// Frontmatter variables

	fmDate: string,
	fmDraft: string,
	fmTitle: string,
	fmSlug: string,
	fmSection: string,
	fmTags: string,
}

export const DEFAULT_SETTINGS: NotesPublisherSettings = {
	publisherUrl: '',
	publisherToken: '',

	diskDestination: '',

	notesFilter: '',
	defaultSection: 'posts',

	fmDate: 'created',
	fmDraft: 'draft',
	fmTitle: 'np-title',
	fmSlug: 'np-slug',
	fmSection: 'np-section',
	fmTags: 'topics',
};
