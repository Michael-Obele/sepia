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
	}: AlertDialogPrimitive.ActionProps & { children?: Snippet } = $props();
</script>

<AlertDialogPrimitive.Action bind:ref data-slot="alert-dialog-action" {...restProps}>
	{#snippet child({ props })}
		<Button class={cn(className)} {...props}>
			{@render children?.()}
		</Button>
	{/snippet}
</AlertDialogPrimitive.Action>