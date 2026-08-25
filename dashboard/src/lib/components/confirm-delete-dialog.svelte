<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { TriangleAlert } from '@lucide/svelte';

	let {
		open = false,
		onClose,
		title = 'Delete this item?',
		description = 'This action cannot be undone. The data will be permanently lost.',
		confirmLabel = 'Delete',
		onConfirm
	}: {
		open?: boolean;
		onClose?: () => void;
		title?: string;
		description?: string;
		confirmLabel?: string;
		onConfirm?: () => void | Promise<void>;
	} = $props();

	// Guards against double-clicks while the delete is in flight.
	let busy = $state(false);

	async function handleConfirm() {
		if (busy) return;
		busy = true;
		try {
			await onConfirm?.();
			onClose?.();
		} finally {
			busy = false;
		}
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(o) => {
		if (!o) onClose?.();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title class="flex items-center gap-2">
				<TriangleAlert class="size-4 shrink-0 text-destructive" />
				{title}
			</AlertDialog.Title>
			<AlertDialog.Description>{description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel>
			<Button variant="destructive" disabled={busy} onclick={handleConfirm}>
				{confirmLabel}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
