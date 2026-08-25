// The app's bundler resolves extensionless TypeScript imports. Node's type
// stripper intentionally does not, so this test-only loader keeps Concordion
// fixtures executing the actual domain modules without changing those modules.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
