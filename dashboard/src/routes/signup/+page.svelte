<script lang="ts">
	import { BrainCircuit, KeyRound, Mail, User } from '@lucide/svelte';
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
	import { signUp } from '$lib/remote/index.js';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
</script>

<svelte:head>
	<title>Create account — Sepia</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center bg-background p-4">
	<Card class="w-full max-w-sm">
		<CardHeader class="text-center">
			<div
				class="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
			>
				<BrainCircuit class="size-6" />
			</div>
			<CardTitle class="text-xl">Create your account</CardTitle>
			<CardDescription>Free forever — 1 namespace, 1,000 memories, 1 AI connection.</CardDescription
			>
		</CardHeader>
		<CardContent>
			<form
				{...signUp.enhance(async (form) => {
					try {
						if (await form.submit()) {
							const result = signUp.result;
							if (result?.token) {
								login(result.token);
								goto('/app');
							} else {
								toast.error('Account created but no session token was returned.');
							}
						}
					} catch (e) {
						toast.error((e as Error)?.message ?? 'Sign-up failed.');
					}
				})}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="name">Name</Label>
					<div class="relative">
						<User class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<input
							id="name"
							placeholder="Ada Lovelace"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							{...signUp.fields.name.as('text')}
						/>
					</div>
					{#each signUp.fields.name.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-destructive">{issue.message}</p>
					{/each}
				</div>
				<div class="space-y-2">
					<Label for="email">Email</Label>
					<div class="relative">
						<Mail class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<input
							id="email"
							placeholder="you@example.com"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							{...signUp.fields.email.as('email')}
						/>
					</div>
					{#each signUp.fields.email.issues() ?? [] as issue (issue.message)}
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
							placeholder="At least 8 characters"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							{...signUp.fields._password.as('password')}
						/>
					</div>
					{#each signUp.fields._password.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-destructive">{issue.message}</p>
					{/each}
				</div>
				<Button type="submit" class="w-full" disabled={signUp.pending > 0}>
					{signUp.pending > 0 ? 'Creating account…' : 'Create account'}
				</Button>
				<p class="text-center text-sm text-muted-foreground">
					Already have an account? <a href="/app" class="font-medium text-primary hover:underline"
						>Sign in</a
					>
				</p>
			</form>
		</CardContent>
	</Card>
</div>
