<script lang="ts">
	import { BrainCircuit, Eye, EyeOff, KeyRound, Mail } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { login } from '$lib/auth.svelte';
	import { signIn } from '$lib/remote/index.js';
	import { toast } from 'svelte-sonner';

	let showPassword = $state(false);
</script>

<div class="flex min-h-svh items-center justify-center bg-background p-4">
	<Card class="w-full max-w-sm">
		<CardHeader class="text-center">
			<div
				class="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
			>
				<BrainCircuit class="size-6" />
			</div>
			<CardTitle class="text-xl">Sepia</CardTitle>
			<CardDescription>Sign in to browse your AI memory knowledge graph.</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				{...signIn.enhance(async (form) => {
					try {
						if (await form.submit()) {
							const result = signIn.result;
							if (result?.token) {
								login(result.token);
							} else {
								toast.error('Sign-in succeeded but no session token was returned.');
							}
						}
					} catch (e) {
						toast.error((e as Error)?.message ?? 'Sign-in failed.');
					}
				})}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="email">Email</Label>
					<div class="relative">
						<Mail class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<input
							id="email"
							placeholder="you@example.com"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							{...signIn.fields.email.as('email')}
						/>
					</div>
					{#each signIn.fields.email.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-destructive">{issue.message}</p>
					{/each}
				</div>
				<div class="space-y-2">
					<Label for="password">Password</Label>
					<div class="relative">
						<KeyRound
							class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							id="password"
							placeholder="Your password"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							{...signIn.fields._password.as('password')}
							type={showPassword ? 'text' : 'password'}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							class="absolute top-0 right-1 bottom-0 my-auto text-muted-foreground hover:text-foreground"
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
					{#each signIn.fields._password.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-destructive">{issue.message}</p>
					{/each}
				</div>
				<Button type="submit" class="w-full" disabled={signIn.pending > 0}>
					{signIn.pending > 0 ? 'Signing in…' : 'Sign in'}
				</Button>
				<div class="flex items-center justify-between text-sm text-muted-foreground">
					<a href="/forgot-password" class="font-medium text-primary hover:underline"
						>Forgot password?</a
					>
					<a href="/signup" class="font-medium text-primary hover:underline">Create an account</a>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
