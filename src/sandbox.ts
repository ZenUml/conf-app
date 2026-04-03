import { SANDBOX_PRESETS, getPresetGroups, type SandboxPreset } from './sandbox/presets';

function createCard(preset: SandboxPreset): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'card';
  const params = new URLSearchParams({ sandbox: preset.id });
  if (preset.macroMode === 'viewer') {
    params.set('outputType', 'display');
  }
  a.href = `./index.html?${params}`;

  const isEditor = preset.macroMode === 'editor';
  const badgeClass = isEditor ? 'badge-editor' : 'badge-viewer';
  const badgeText = isEditor ? 'Editor' : 'Viewer';

  a.innerHTML = `
    <div class="card-label">${preset.label}</div>
    <div class="card-meta">
      <span class="badge ${badgeClass}">${badgeText}</span>
      &nbsp; ${preset.moduleKey}
    </div>
  `;
  return a;
}

function render() {
  const root = document.getElementById('root');
  if (!root) return;

  const groups = getPresetGroups();

  for (const [groupName, presets] of Object.entries(groups)) {
    const section = document.createElement('div');
    section.className = 'group';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = groupName;
    section.appendChild(title);

    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const preset of presets) {
      cards.appendChild(createCard(preset));
    }
    section.appendChild(cards);
    root.appendChild(section);
  }
}

render();
