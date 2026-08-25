import { resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolvePath(fileURLToPath(new URL('../..', import.meta.url)))

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const sourcePath = resolvePath(repositoryRoot, 'src', specifier.slice(2))
    const withExtension = /\.(?:m?ts|tsx|js|jsx)$/.test(sourcePath) ? sourcePath : `${sourcePath}.ts`
    return nextResolve(pathToFileURL(withExtension).href, context)
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
