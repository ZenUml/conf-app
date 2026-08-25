// Node's TypeScript stripping does not resolve extensionless TypeScript
// specifiers. The product modules intentionally use bundler-friendly imports;
// this analysis-only loader supplies the missing `.ts` resolution in bare Node.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
