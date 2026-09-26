<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Search, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { saveMemory, getEntities } from '$lib/remote/index.js';
	import { parseTags } from '$lib/remote/parsers';
	import { MEMORY_TYPES, ALWAYS_TAG } from '@sepia/shared/types';

	let {
		open = $bindable(false),
		namespaces = [],
		memory = null,
		onSaved = () => {}
	}: {
		open?: boolean;
		namespaces?: string[];
		memory?: Record<string, unknown> | null;
		onSaved?: () => void;
	} = $props();

	let content = $state('');
	let type = $state<'fact' | 'observation' | 'preference' | 'instruction'>('fact');
	let importance = $state(0.5);
	let namespace = $state('personal');
	let entityIds = $state<string[]>([]);
	let tagsText = $state('');

	let entityQuery = $state('');
	let entityResults = $state<Awaited<ReturnType<typeof getEntities>>>([]);
	let searchingEntities = $state(false);

	// Reset the form when the dialog opens or the memory changes.
	$effect(() => {
		if (open) {
			content = memory?.content ? String(memory.content) : '';
			type = (memory?.type as typeof type) ?? 'fact';
			importance = typeof memory?.importance === 'number' ? memory.importance : 0.5;
			namespace = memory?.namespace ? String(memory.namespace) : (namespaces[0] ?? 'personal');
			entityIds = memory?.entity_ids ? (memory.entity_ids as string[]) : [];
			tagsText = Array.isArray(memory?.tags) ? (memory.tags as string[]).join(', ') : '';
			entityQuery = '';
			entityResults = [];
		}
	});

	async function searchEntities() {
		if (!entityQuery.trim()) {
			entityResults = [];
			return;
		}
		searchingEntities = true;
		try {
			entityResults = await getEntities({ q: entityQuery, namespace, limit: 8 });
		} finally {
			searchingEntities = false;
		}
	}

	function toggleEntity(id: string) {
		if (entityIds.includes(id)) {
			entityIds = entityIds.filter((x) => x !== id);
		} else if (entityIds.length < 3) {
			entityIds = [...entityIds, id];
		} else {
			toast.warning('A memory can link to at most 3 entities');
		}
	}

	/**
	 * The `always` tag is what puts a rule into the core briefing regardless of
	 * importance. It edits `tagsText` — the FULL tag set — because a `tags`
	 * update REPLACES every tag on the row; a partial set would destroy them.
	 */
	const alwaysOn = $derived(parseTags(tagsText).includes(ALWAYS_TAG));

	function setAlways(on: boolean) {
		const tags = parseTags(tagsText);
		const next = on ? [...new Set([...tags, ALWAYS_TAG])] : tags.filter((t) => t !== ALWAYS_TAG);
		tagsText = next.join(', ');
	}

	// The save flow lives in the remote form (`saveMemory`): this dialog renders
	// named inputs (plus hidden id/importance/entity links), enhance toasts.
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{memory?.id ? 'Edit memory' : 'New memory'}</Dialog.Title>
			<Dialog.Description>
				{memory?.id
					? 'Update this knowledge fragment.'
					: 'Record a fact, observation, preference, or instruction.'}
			</Dialog.Description>
		</Dialog.Header>

		<!-- display:contents keeps the dialog's grid layout; the form is the save path. -->
		<form
			{...saveMemory.enhance(async (f) => {
				try {
					if (await f.submit()) {
						toast.success(memory?.id ? 'Memory updated' : 'Memory created');
						open = false;
						onSaved();
					} else {
						toast.error(f.fields.allIssues()?.[0]?.message ?? 'Check the form fields');
					}
				} catch (e) {
					toast.error((e as Error)?.message ?? 'Failed to save memory');
				}
			})}
			class="contents"
		>
			<div class="space-y-4 py-2">
				<!-- .as('hidden') supplies name, type and value; id '' means create. -->
				<input {...saveMemory.fields.id.as('hidden', String(memory?.id ?? ''))} />
				{#each entityIds as linkedId (linkedId)}
					<input type="hidden" name="entity_ids[]" value={linkedId} />
				{/each}
				<div class="space-y-2">
					<Label for="mem-content">Content</Label>
					<!-- Fixed height (h-30) with the component's min-h-16 floor dropped: long text
				     scrolls inside instead of growing the dialog past the fields below. -->
					<Textarea
						class="field-sizing-none h-30 min-h-0"
						id="mem-content"
						name="content"
						bind:value={content}
						rows={4}
						placeholder="What did you learn?"
					/>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="mem-type">Memory type</Label>
						<select
							id="mem-type"
							name="type"
							bind:value={type}
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
						>
							{#each MEMORY_TYPES as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="mem-ns">Namespace</Label>
						<select
							id="mem-ns"
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
					<Label for="mem-tags">Tags</Label>
					<Input
						id="mem-tags"
						name="tags"
						bind:value={tagsText}
						placeholder="comma-separated, e.g. user-experience, auth, performance"
					/>
				</div>

				<div class="flex items-center justify-between gap-4 rounded-md border p-3">
					<div class="space-y-1">
						<Label for="mem-always">Always — load at every session</Label>
						<p class="text-xs text-muted-foreground">
							Core briefing rule: loads unconditionally at the start of every AI session, whatever
							its importance.
						</p>
					</div>
					<Switch id="mem-always" checked={alwaysOn} onCheckedChange={setAlways} />
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
					<input {...saveMemory.fields.importance.as('hidden', importance)} />
				</div>

				<div class="space-y-2">
					<Label>Linked entities (max 3)</Label>
					<div class="relative">
						<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							bind:value={entityQuery}
							placeholder="Search entities to link…"
							class="pl-9"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									searchEntities();
								}
							}}
						/>
					</div>
					{#if entityResults.length > 0}
						<div class="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
							{#each entityResults as e}
								<button
									type="button"
									onclick={() => toggleEntity(String(e.id))}
									class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
								>
									<span class="truncate">{e.name}</span>
									{#if entityIds.includes(String(e.id))}
										<Badge variant="secondary">Linked</Badge>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
					{#if entityIds.length > 0}
						<div class="flex flex-wrap gap-1">
							{#each entityIds as id}
								<Badge variant="outline" class="gap-1 pr-1">
									{id.slice(0, 8)}…
									<button type="button" onclick={() => toggleEntity(id)} aria-label="Remove link">
										<X class="size-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="ghost" {...props}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={saveMemory.pending > 0}>
					{saveMemory.pending > 0 ? 'Saving…' : memory?.id ? 'Save changes' : 'Create memory'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
