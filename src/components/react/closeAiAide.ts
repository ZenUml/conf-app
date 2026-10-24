export async function closeAiAide(): Promise<void> {
  const { view } = await import('@forge/bridge');
  await view.close();
}
