#!/usr/bin/env -S pnpm exec tsx

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Item = { id: string; candidatePath: string };

function arg(name: string): string {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) {
		throw new Error(`Missing ${name}`);
	}
	return process.argv[index + 1];
}

async function main() {
	const manifestPath = resolve(arg("--manifest"));
	const outputPath = resolve(arg("--output"));
	const diagramlyPath = resolve(arg("--diagramly-path"));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		languageKey: string;
		items: Item[];
	};
	const parserPath = join(
		diagramlyPath,
		"apps/web/modules/saas/diagram/services/deterministic-syntax-parser.ts",
	);
	// The app's parser imports workspace aliases that tsx may resolve through a
	// CommonJS boundary when this external helper runs. Mermaid's parser is
	// headless and the same version is installed in Diagramly's web package, so
	// use it directly for Mermaid syntax checks. This is still a syntax check;
	// browser rendering remains a separate acceptance gate.
	let mermaid: (typeof import("mermaid"))["default"] | null = null;
	if (manifest.languageKey === "LANG_MERMAID") {
		const sanitizerPath = join(
			diagramlyPath,
			"apps/web/lib/ai/mermaid-server-sanitizer.ts",
		);
		const { prepareMermaidServerSanitizer } = await import(
			pathToFileURL(sanitizerPath).href
		);
		await prepareMermaidServerSanitizer();
		// Use the package entry (mermaid.core.mjs), not the self-contained
		// mermaid.esm.mjs bundle: the bundle embeds another DOMPurify instance
		// that the server sanitizer cannot prepare.
		mermaid = (await import(pathToFileURL(join(
			diagramlyPath,
			"apps/web/node_modules/mermaid/dist/mermaid.core.mjs",
		)).href)).default;
	}
	const deterministicSyntaxParser = mermaid
		? null
		: (await import(pathToFileURL(parserPath).href) as {
			deterministicSyntaxParser: (
				code: string,
				languageKey: string,
			) => Promise<string | null>;
		}).deterministicSyntaxParser;

	const results: Array<Record<string, unknown>> = [];
	for (const item of manifest.items) {
		const code = readFileSync(resolve(item.candidatePath), "utf8");
		if (manifest.languageKey === "LANG_PLANTUML") {
			results.push({ id: item.id, skipped: true, error: null });
			continue;
		}
		let error: string | null;
		if (mermaid) {
			try {
				await mermaid.parse(code);
				error = null;
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} else {
			error = await deterministicSyntaxParser!(code, manifest.languageKey);
		}
		results.push({ id: item.id, skipped: false, error });
	}
	writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
