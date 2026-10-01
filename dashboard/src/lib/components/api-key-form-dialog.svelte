<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { saveApiKey } from '$lib/remote/index.js';

	/**
	 * One dialog for both API-key naming flows — the name is what tells a
	 * user which key is for what (and which one to delete):
	 *
	 * - `editing` null → create: the name is REQUIRED (input `required`,
	 *   submit disabled while empty, server schema `minLength(1)`), and the
	 *   fresh plaintext key is handed to the parent via `onCreated` — the
	 *   page shows it once, in its own key banner.
	 * - `editing` set → rename an existing key, including legacy rows that
	 *   predate named keys ("Untitled key"). The secret itself never changes.
	 */
	let {
		open = $bindable(false),
		editing = null,
		onCreated = () => {},
		onSaved = () => {}
	}: {
		open?: boolean;
		editing?: { id: string; name: string } | null;
		onCreated?: (created: { id: string; key: string }) => void;
		onSaved?: () => void;
	} = $props();

	let name = $state('');

	// Reset the input every time the dialog opens — create starts empty,
	// rename starts from the key's current name. enhance does not reset it.
	$effect(() => {
		if (open) name = editing?.name ?? '';
	});

	const canSubmit = $derived(name.trim().length > 0);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editing ? 'Rename API key' : 'Name your API key'}</Dialog.Title>
			<Dialog.Description>
				{editing
					? 'Only the label changes — the key itself keeps working.'
					: 'A clear name tells you what each key is for, and which one to delete when that setup changes.'}
			</Dialog.Description>
		</Dialog.Header>

		<!-- display:contents keeps the dialog's grid layout; the form is the save path. -->
		<form
			{...saveApiKey.enhance(async (f) => {
				try {
					if (await f.submit()) {
						const created = f.result;
						if (created) {
							onCreated(created);
							toast.success('API key created — copy it now, it is shown only once');
						} else {
							toast.success(`Renamed to “${name.trim()}”`);
						}
						open = false;
						onSaved();
					} else {
						toast.error(f.fields.allIssues()?.[0]?.message ?? 'Check the form fields');
					}
				} catch (e) {
					toast.error((e as Error)?.message ?? 'Failed to save API key');
				}
			})}
			class="contents"
		>
			<div class="space-y-4 py-2">
				<!-- .as('hidden') supplies name, type and value; empty id means create. -->
				<input {...saveApiKey.fields.id.as('hidden', editing?.id ?? '')} />
				<div class="space-y-2">
					<Label for="apikey-name">Name</Label>
					<Input
						id="apikey-name"
						name="name"
						bind:value={name}
						required
						maxlength={64}
						placeholder="e.g. Claude Code — laptop"
						autocomplete="off"
					/>
					<p class="text-xs text-muted-foreground">
						{editing
							? 'Shown next to the key in your key list.'
							: 'Name it after the tool or machine that uses it. You can rename it later.'}
					</p>
				</div>
			</div>

			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="ghost" {...props}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={!canSubmit || saveApiKey.pending > 0}>
					{saveApiKey.pending > 0
						? editing
							? 'Saving…'
							: 'Creating…'
						: editing
							? 'Save name'
							: 'Create key'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
