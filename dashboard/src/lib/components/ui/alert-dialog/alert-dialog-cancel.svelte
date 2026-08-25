<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: AlertDialogPrimitive.CancelProps & { children?: Snippet } = $props();
</script>

<AlertDialogPrimitive.Cancel bind:ref data-slot="alert-dialog-cancel" {...restProps}>
	{#snippet child({ props })}
		<Button variant="outline" class={cn(className)} {...props}>
			{@render children?.()}
		</Button>
	{/snippet}
</AlertDialogPrimitive.Cancel>