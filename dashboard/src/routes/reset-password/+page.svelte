<script lang="ts">
	import { BrainCircuit, CheckCircle2, Eye, EyeOff, KeyRound } from '@lucide/svelte';
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
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const token = $derived(String(page.url.searchParams.get('token') ?? ''));

	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let done = $state(false);
	let loading = $state(false);
	let showPassword = $state(false);
	let showConfirm = $state(false);

	async function submit() {
		if (!token) {
			error = 'This reset link is invalid or expired. Request a new one.';
			return;
		}
		if (password.length < 8) {
			error = 'Password must be at least 8 characters.';
			return;
		}
		if (password !== confirm) {
			error = 'Passwords do not match.';
			return;
		}
		error = '';
		loading = true;
		try {
			const { error: resetError } = await authClient.resetPassword({
				newPassword: password,
				token
			});
			if (resetError) {
				error = resetError.message ?? 'Reset failed. The link may have expired.';
				return;
			}
			showPassword = false;
			showConfirm = false;
			done = true;
		} catch (e) {
			error = (e as Error)?.message ?? 'Reset failed.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Reset password — Sepia</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center bg-background p-4">
	<Card class="w-full max-w-sm">
		<CardHeader class="text-center">
			<div
				class="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
			>
				<BrainCircuit class="size-6" />
			</div>
			<CardTitle class="text-xl">Reset your password</CardTitle>
			<CardDescription>Choose a new password for your Sepia account.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if done}
				<div class="flex flex-col items-center gap-3 py-4 text-center">
					<CheckCircle2 class="size-10 text-emerald-500" />
					<p class="font-medium">Password updated</p>
					<p class="text-sm text-muted-foreground">You can now sign in with your new password.</p>
					<Button class="w-full" onclick={() => goto('/app')}>Sign in</Button>
				</div>
			{:else if !token}
				<div class="flex flex-col items-center gap-3 py-4 text-center">
					<p class="text-sm text-muted-foreground">
						This reset link is invalid or expired. Request a new one from the sign-in page.
					</p>
					<Button variant="outline" class="w-full" onclick={() => goto('/app')}
						>Back to sign in</Button
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
						<Label for="password">New password</Label>
						<div class="relative">
							<KeyRound
								class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<input
								id="password"
								type={showPassword ? 'text' : 'password'}
								placeholder="At least 8 characters"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								bind:value={password}
								autocomplete="new-password"
								required
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								class="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								aria-label={showPassword ? 'Hide password' : 'Show password'}
								aria-controls="password"
								onclick={() => (showPassword = !showPassword)}
							>
								{#if showPassword}
									<EyeOff class="size-4" />
								{:else}
									<Eye class="size-4" />
								{/if}
							</Button>
						</div>
					</div>
					<div class="space-y-2">
						<Label for="confirm">Confirm password</Label>
						<div class="relative">
							<KeyRound
								class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<input
								id="confirm"
								type={showConfirm ? 'text' : 'password'}
								placeholder="Repeat your new password"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								bind:value={confirm}
								autocomplete="new-password"
								required
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								class="absolute top-0 right-1 bottom-0 my-auto text-muted-foreground hover:text-foreground"
								aria-label={showConfirm ? 'Hide password' : 'Show password'}
								aria-controls="confirm"
								onclick={() => (showConfirm = !showConfirm)}
							>
								{#if showConfirm}
									<EyeOff class="size-4" />
								{:else}
									<Eye class="size-4" />
								{/if}
							</Button>
						</div>
					</div>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Resetting…' : 'Reset password'}
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
</div>
