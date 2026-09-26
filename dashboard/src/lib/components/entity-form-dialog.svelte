<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { toast } from 'svelte-sonner';
	import { saveEntity } from '$lib/remote/index.js';
	import { ENTITY_TYPES } from '@sepia/shared/types';

	let {
		open = $bindable(false),
		namespaces = [],
		entity = null,
		onSaved = () => {}
	}: {
		open?: boolean;
		namespaces?: string[];
		entity?: Record<string, unknown> | null;
		onSaved?: () => void;
	} = $props();

	let name = $state('');
	let type = $state('concept');
	let summary = $state('');
	let importance = $state(0.5);
	let namespace = $state('personal');
	let tagsText = $state('');

	$effect(() => {
		if (open) {
			name = entity?.name ? String(entity.name) : '';
			type = entity?.type ? String(entity.type) : 'concept';
			summary = entity?.summary ? String(entity.summary) : '';
			importance = typeof entity?.importance === 'number' ? entity.importance : 0.5;
			namespace = entity?.namespace ? String(entity.namespace) : (namespaces[0] ?? 'personal');
			tagsText = Array.isArray(entity?.tags) ? (entity.tags as string[]).join(', ') : '';
		}
	});

	// The save flow lives in the remote form (`saveEntity`): this dialog renders
	// named inputs (plus hidden id/importance), the enhance callback toasts.
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{entity?.id ? 'Edit entity' : 'New entity'}</Dialog.Title>
			<Dialog.Description>
				{entity?.id
					? 'Update this knowledge-graph node.'
					: 'Create a knowledge-graph node (person, project, tool, concept…).'}
			</Dialog.Description>
		</Dialog.Header>

		<!-- display:contents keeps the dialog's grid layout; the form is the save path. -->
		<form
			{...saveEntity.enhance(async (f) => {
				try {
					if (await f.submit()) {
						toast.success(entity?.id ? 'Entity updated' : 'Entity created');
						open = false;
						onSaved();
					} else {
						toast.error(f.fields.allIssues()?.[0]?.message ?? 'Check the form fields');
					}
				} catch (e) {
					toast.error((e as Error)?.message ?? 'Failed to save entity');
				}
			})}
			class="contents"
		>
			<div class="space-y-4 py-2">
				<!-- .as('hidden') supplies name, type and value; id '' means create. -->
				<input {...saveEntity.fields.id.as('hidden', String(entity?.id ?? ''))} />
				<div class="space-y-2">
					<Label for="ent-name">Name</Label>
					<Input id="ent-name" name="name" bind:value={name} placeholder="e.g. Bun" />
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="ent-type">Entity type</Label>
						<select
							id="ent-type"
							name="type"
							bind:value={type}
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
						>
							{#each ENTITY_TYPES as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="ent-ns">Namespace</Label>
						<select
							id="ent-ns"
							name="namespace"
							bind:value={namespace}
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
						>
							{#each namespaces as n}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="space-y-2">
					<Label for="ent-tags">Tags</Label>
					<Input
						id="ent-tags"
						name="tags"
						bind:value={tagsText}
						placeholder="comma-separated, e.g. svelte, auth, performance"
					/>
				</div>

				<div class="space-y-2">
					<Label for="ent-summary">Summary</Label>
					<Textarea
						id="ent-summary"
						name="summary"
						bind:value={summary}
						rows={3}
						placeholder="What is this entity?"
					/>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label>Importance</Label>
						<span class="text-sm text-muted-foreground">{Math.round(importance * 100)}%</span>
					</div>
					<Slider
						type="single"
						value={importance}
						onValueChange={(v: number) => (importance = v)}
						min={0}
						max={1}
						step={0.05}
					/>
					<!-- The slider is not a form control; this mirrors its value (n: → number). -->
					<input {...saveEntity.fields.importance.as('hidden', importance)} />
				</div>
			</div>

			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="ghost" {...props}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={saveEntity.pending > 0}>
					{saveEntity.pending > 0 ? 'Saving…' : entity?.id ? 'Save changes' : 'Create entity'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
