#!/usr/bin/env -S pnpm exec tsx

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Manifest = {
	dslPath: string;
	errorMessage?: string;
	diagramType: string;
	languageKey: string;
	subTypeKey?: string;
	command?: string;
};

function arg(name: string): string {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) {
		throw new Error(`Missing ${name}`);
	}
	return process.argv[index + 1];
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

async function main() {
	const manifestPath = resolve(arg("--manifest"));
	const outputPath = resolve(arg("--output"));
	const diagramlyPath = resolve(arg("--diagramly-path"));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
	const dslPath = isAbsolute(manifest.dslPath)
		? manifest.dslPath
		: resolve(dirname(manifestPath), manifest.dslPath);
	const currentCode = readFileSync(dslPath, "utf8");
	const hookPath = join(
		diagramlyPath,
		"packages/core/diagram/utils/ai-provider-diagram-hooks.ts",
	);
	const builderPath = join(
		diagramlyPath,
		"packages/core/ai/prompts/builder.ts",
	);
	const { promptBuilder } = (await import(pathToFileURL(builderPath).href)) as {
		promptBuilder: {
			buildModifyCommand: (input: Record<string, unknown>) => string;
			buildSystemPrompt: (input: Record<string, unknown>) => string;
		};
	};
	const { preAIProviderDiagramHook } = (await import(
		pathToFileURL(hookPath).href
	)) as {
		preAIProviderDiagramHook: (code: string, languageKey?: string) => string;
	};

	const command =
		manifest.command?.trim() ||
		"Please fix the reported error and change nothing else.";
	const subTypeKey = manifest.subTypeKey || "GENERAL";
	const codeForAI = preAIProviderDiagramHook(currentCode, manifest.languageKey);
	const modifyCommand = promptBuilder.buildModifyCommand({
		diagramType: manifest.languageKey || manifest.diagramType,
		languageKey: manifest.languageKey,
		command,
		currentCode,
		errorMessage: manifest.errorMessage,
	});
	let systemPrompt = promptBuilder.buildSystemPrompt({
		languageKey: manifest.languageKey,
		subTypeKey,
		scenario: "modify",
		currentCode: codeForAI,
		command: modifyCommand,
	});

	// Mirror AIDiagramService.buildModifyMessages, including the pre-provider hook.
	const missingContext: string[] = [];
	if (codeForAI && !systemPrompt.includes(codeForAI)) {
		missingContext.push(
			["Current diagram code:", "```", codeForAI, "```"].join("\n"),
		);
	}
	if (modifyCommand && !systemPrompt.includes(modifyCommand)) {
		missingContext.push(`Requested change:\n${modifyCommand}`);
	}
	if (missingContext.length > 0) {
		systemPrompt = [systemPrompt, ...missingContext]
			.filter(Boolean)
			.join("\n\n");
	}

	const cacheEnabled = process.env.AI_PROMPT_CACHE === "true";
	const messages = [
		{
			role: "system",
			content: [
				{
					type: "text",
					text: systemPrompt,
					...(cacheEnabled ? { cache_control: { type: "ephemeral" } } : {}),
				},
			],
		},
		{
			role: "user",
			content: "Apply the repair instructions above and return the JSON.",
		},
	];
	const sourceText = readFileSync(builderPath, "utf8");
	const hookSourceText = readFileSync(hookPath, "utf8");
	let commit = "unknown";
	try {
		commit = execFileSync("git", ["-C", diagramlyPath, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		// A source hash still makes the prompt reproducible outside a git checkout.
	}

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(
		outputPath,
		`${JSON.stringify(
			{
				messages,
				promptHash: sha256(JSON.stringify(messages)),
				inputSha256: sha256(currentCode),
				diagramlyCommit: commit,
				promptBuilderSha256: sha256(sourceText),
				preProviderHookSha256: sha256(hookSourceText),
				promptCacheEnabled: cacheEnabled,
				languageKey: manifest.languageKey,
				subTypeKey,
			},
			null,
			2,
		)}\n`,
	);
	console.log(
		JSON.stringify({
			output: outputPath,
			promptHash: sha256(JSON.stringify(messages)),
			diagramlyCommit: commit,
		}),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
