<script lang="ts">
	import { BrainCircuit, Mail, CheckCircle2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { authClient } from '$lib/auth-client';

	let email = $state('');
	let error = $state('');
	let sent = $state(false);
	let loading = $state(false);

	async function submit() {
		if (!email.trim()) {
			error = 'Enter your email address.';
			return;
		}
		error = '';
		loading = true;
		try {
			// Always show success even if the email doesn't exist — never leak
			// which addresses are registered (enumeration protection).
			const { error: reqError } = await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: `${window.location.origin}/reset-password`
			});
			if (reqError) {
				// Rate-limited or invalid — still show the generic message.
				console.warn('[forgot-password]', reqError.message);
			}
			sent = true;
		} catch (e) {
			console.warn('[forgot-password]', e);
			sent = true;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Forgot password — Sepia</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center bg-background p-4">
	<Card class="w-full max-w-sm">
		<CardHeader class="text-center">
			<div
				class="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
			>
				<BrainCircuit class="size-6" />
			</div>
			<CardTitle class="text-xl">Forgot your password?</CardTitle>
			<CardDescription>We'll email you a link to reset it.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if sent}
				<div class="flex flex-col items-center gap-3 py-4 text-center">
					<CheckCircle2 class="size-10 text-emerald-500" />
					<p class="font-medium">Check your inbox</p>
					<p class="text-sm text-muted-foreground">
						If an account exists for that email, a reset link is on its way. It expires in 1 hour.
					</p>
					<a href="/app" class="text-sm font-medium text-primary hover:underline">Back to sign in</a
					>
				</div>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						submit();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<div class="relative">
							<Mail class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
							<input
								id="email"
								type="email"
								placeholder="you@example.com"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								bind:value={email}
								autocomplete="email"
								required
							/>
						</div>
					</div>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Sending…' : 'Send reset link'}
					</Button>
					<p class="text-center text-sm text-muted-foreground">
						Remembered it? <a href="/app" class="font-medium text-primary hover:underline"
							>Sign in</a
						>
					</p>
				</form>
			{/if}
		</CardContent>
	</Card>
</div>
