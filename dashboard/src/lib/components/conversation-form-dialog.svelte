<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import { ingestConversationData } from '$lib/remote/index.js';
	import { auth } from '$lib/auth.svelte';

	let {
		open = $bindable(false),
		namespaces = [],
		onSaved = () => {}
	}: {
		open?: boolean;
		namespaces?: string[];
		onSaved?: () => void;
	} = $props();

	let summary = $state('');
	let title = $state('');
	let status = $state<'active' | 'paused' | 'done'>('active');
	let conversationId = $state('');
	let decisions = $state('');
	let preferences = $state('');
	let instructions = $state('');
	let observations = $state('');
	let openQuestions = $state('');
	let entitiesText = $state('');
	let sourceAi = $state('');
	let sourceRef = $state('');
	let tagsText = $state('');
	let namespace = $state('personal');
	let saving = $state(false);

	// Reset the form when the dialog opens.
	$effect(() => {
		if (open) {
			summary = '';
			title = '';
			status = 'active';
			conversationId = '';
			decisions = '';
			preferences = '';
			instructions = '';
			observations = '';
			openQuestions = '';
			entitiesText = '';
			sourceAi = '';
			sourceRef = '';
			tagsText = '';
			namespace = namespaces[0] ?? 'personal';
		}
	});

	function lines(text: string): string[] {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
	}

	function parseTags(text: string): string[] {
		return text
			.split(',')
			.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
			.filter(Boolean);
	}

	/** "Name:type:summary" per line — type defaults to concept. */
	function parseEntities(text: string): { name: string; type: string; summary?: string }[] {
		return lines(text).map((line) => {
			const [name, type, ...rest] = line.split(':').map((s) => s.trim());
			return {
				name: name ?? line,
				type: type || 'concept',
				summary: rest.join(':') || undefined
			};
		});
	}

	/** Slugify a title into a conversation_id (e.g. "Auth migration" → "auth-migration"). */
	function slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 200);
	}

	async function save() {
		if (!summary.trim()) {
			toast.error('Summary is required');
			return;
		}
		if (!title.trim()) {
			toast.error("Title is required — it's how you tell conversations apart when resuming");
			return;
		}
		// Auto-derive the conversation_id from the title when left empty.
		const cid = conversationId.trim() || slugify(title);
		if (!cid) {
			toast.error('Conversation ID is required (groups digests of the same conversation)');
			return;
		}
		saving = true;
		try {
			const result = await ingestConversationData([
				auth.token,
				{
					summary: summary.trim(),
					title: title.trim(),
					status,
					conversation_id: cid,
					decisions: lines(decisions),
					preferences: lines(preferences),
					instructions: lines(instructions),
					observations: lines(observations),
					open_questions: lines(openQuestions),
					entities: parseEntities(entitiesText),
					source: sourceAi.trim()
						? { ai: sourceAi.trim(), ref: sourceRef.trim() || undefined }
						: undefined,
					tags: parseTags(tagsText),
					namespace
				}
			]);
			toast.success(
				`Conversation saved — ${result.memories_created} memories, ${result.entities_created} entities created`
			);
			open = false;
			onSaved();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to save conversation');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85svh] max-w-2xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Save conversation</Dialog.Title>
			<Dialog.Description>
				Distill a conversation into a handoff digest — the next AI can continue without the raw
				transcript.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class="space-y-2">
					<Label for="conv-title">Title</Label>
					<Input
						id="conv-title"
						bind:value={title}
						placeholder="e.g. Auth migration — Neon vs Supabase"
					/>
					<p class="text-xs text-muted-foreground">
						How you tell conversations apart when resuming.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="conv-status">Status</Label>
					<select
						id="conv-status"
						bind:value={status}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="active">active — resume me</option>
						<option value="paused">paused</option>
						<option value="done">done</option>
					</select>
					<p class="text-xs text-muted-foreground">Active conversations are the ones to continue.</p>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="conv-summary">Summary (digest)</Label>
				<Textarea
					id="conv-summary"
					bind:value={summary}
					rows={5}
					placeholder="# Context&#10;# Decisions&#10;# Open questions&#10;# Artifacts (paths, commands, IDs)"
				/>
				<p class="text-xs text-muted-foreground">
					≤4000 chars. Anti-dump: if it doesn't fit, split into more digests with the same
					conversation ID.
				</p>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="conv-id">Conversation ID</Label>
					<Input
						id="conv-id"
						bind:value={conversationId}
						placeholder="auto-derived from title"
					/>
					<p class="text-xs text-muted-foreground">
						Groups digests of the same conversation. Leave empty to derive from the title.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="conv-ns">Namespace</Label>
					<select
						id="conv-ns"
						bind:value={namespace}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					>
						{#each namespaces as n (n)}
							<option value={n}>{n}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class="space-y-2">
					<Label for="conv-decisions">Decisions (one per line)</Label>
					<Textarea
						id="conv-decisions"
						bind:value={decisions}
						rows={3}
						placeholder="Chose Neon over Supabase because…"
					/>
				</div>
				<div class="space-y-2">
					<Label for="conv-prefs">Preferences (one per line)</Label>
					<Textarea
						id="conv-prefs"
						bind:value={preferences}
						rows={3}
						placeholder="Prefers tabs over spaces"
					/>
				</div>
				<div class="space-y-2">
					<Label for="conv-instructions">Instructions (one per line)</Label>
					<Textarea
						id="conv-instructions"
						bind:value={instructions}
						rows={3}
						placeholder="Always run bun check before committing"
					/>
				</div>
				<div class="space-y-2">
					<Label for="conv-observations">Observations (one per line)</Label>
					<Textarea
						id="conv-observations"
						bind:value={observations}
						rows={3}
						placeholder="Error E123: exact stack trace / verbatim quote"
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="conv-open">Open questions / next steps (one per line)</Label>
				<Textarea
					id="conv-open"
					bind:value={openQuestions}
					rows={2}
					placeholder="Should we add a 5th memory type?"
				/>
			</div>

			<div class="space-y-2">
				<Label for="conv-entities">Entities (one per line: name:type:summary)</Label>
				<Textarea
					id="conv-entities"
					bind:value={entitiesText}
					rows={2}
					placeholder="sepia:project:memory server&#10;bun:tool:JS runtime"
				/>
				<p class="text-xs text-muted-foreground">
					Type defaults to concept. Find-or-create in the namespace.
				</p>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="conv-source-ai">Source AI</Label>
					<Input id="conv-source-ai" bind:value={sourceAi} placeholder="e.g. claude-code" />
				</div>
				<div class="space-y-2">
					<Label for="conv-source-ref">Source ref (session path / share URL)</Label>
					<Input
						id="conv-source-ref"
						bind:value={sourceRef}
						placeholder="~/.claude/projects/… or share link"
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="conv-tags">Topic tags</Label>
				<Input
					id="conv-tags"
					bind:value={tagsText}
					placeholder="comma-separated, e.g. auth, migration"
				/>
				<p class="text-xs text-muted-foreground">The tag `conversation` is added automatically.</p>
			</div>
		</div>

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="ghost" {...props}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button onclick={save} disabled={saving}>
				{saving ? 'Saving…' : 'Save conversation'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
