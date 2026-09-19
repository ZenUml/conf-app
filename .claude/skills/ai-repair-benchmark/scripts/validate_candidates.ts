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
	const { deterministicSyntaxParser } = (await import(
		pathToFileURL(parserPath).href
	)) as {
		deterministicSyntaxParser: (
			code: string,
			languageKey: string,
		) => Promise<string | null>;
	};

	const results: Array<Record<string, unknown>> = [];
	for (const item of manifest.items) {
		const code = readFileSync(resolve(item.candidatePath), "utf8");
		if (manifest.languageKey === "LANG_PLANTUML") {
			results.push({ id: item.id, skipped: true, error: null });
			continue;
		}
		const error = await deterministicSyntaxParser(code, manifest.languageKey);
		results.push({ id: item.id, skipped: false, error });
	}
	writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
