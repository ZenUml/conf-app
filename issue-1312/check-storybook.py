import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('/tmp/conf-app-1312-evidence')
CLI = ['/usr/local/bin/agent-browser', '--session', 'conf-app-1312']
PORT = os.environ.get('STORYBOOK_PORT', '6006')
BASE = f'http://localhost:{PORT}/iframe.html?id=editor-diagram-workspacemermaidinlineintro--'
RUN = str(time.time_ns())
DIALOG = 'dialog[open]'
SOURCE = '#workspace-left .cm-content'
SVG = {
    'sequence': '#workspace-right svg[aria-roledescription="sequence"]',
    'flowchart': '#workspace-right svg[aria-roledescription^="flowchart"]',
    'unsupported': '#workspace-right svg[aria-roledescription]',
    'editor-under-paywall': '#workspace-right svg[aria-roledescription^="flowchart"]',
}
END_LABEL = {'sequence': 'Confirm order', 'flowchart': 'Approve'}
END_LINE = {'sequence': 'C->>S: Confirm order', 'flowchart': 'A[Start] --> B[Approve]'}


def browser(*args, output=False):
    result = subprocess.run([*CLI, *args], text=True, capture_output=True, timeout=35, check=True)
    return result.stdout if output else None


def evaluate(expression):
    result = json.loads(browser('--json', 'eval', expression, output=True))
    assert result['success'], result
    return result['data']['result']


def enter(kind, author, delay=0):
    browser('open', f'{BASE}{kind}&viewMode=story&introAccount={author}-{RUN}&introDelay={delay}')
    browser('wait', SVG[kind])


def wait_modal():
    browser('wait', DIALOG)
    assert evaluate('document.activeElement?.getAttribute("aria-label")') == 'Close'
    assert evaluate('!document.querySelector("dialog input[type=checkbox]")')


def modal_phase():
    return evaluate('document.querySelector("dialog[open]")?.dataset.phase ?? null')


def check_absent():
    for _ in range(4):
        assert modal_phase() is None
        time.sleep(.2)


def dismiss(method):
    if method == 'escape':
        browser('press', 'Escape')
    else:
        browser('click', f'{DIALOG} .intro-{method}')
    assert modal_phase() is None


def complete(kind):
    browser('wait', f'{DIALOG}[data-phase="complete"]')
    assert evaluate('document.querySelector(".example-diagram .example-label").textContent.trim()') == END_LABEL[kind]
    assert evaluate('document.querySelector(".example-source .updated-line code").textContent') == END_LINE[kind]
    assert evaluate('document.querySelector(".example-source").getBoundingClientRect().right <= document.querySelector(".example-diagram").getBoundingClientRect().left')
    if kind == 'flowchart':
        assert evaluate('document.querySelector(".example-source ol li:last-child code").textContent') == 'B --> C[Send]'
        assert evaluate('document.querySelectorAll(".example-diagram .example-arrow").length') == 2
        assert 'label on a connecting arrow' in evaluate('document.querySelector("dialog p").textContent')


def screenshot(name):
    browser('screenshot', str(ROOT / f'{name}.png'))


def read_source():
    return evaluate(f'document.querySelector({json.dumps(SOURCE)}).innerText')


def durable_types(author):
    return evaluate(f'Object.keys(localStorage).filter(k => k.startsWith("storybook:confluence:") && k.includes("/{author}-{RUN}/")).sort().map(k => k.split("-").at(-1))')


browser('set', 'viewport', '1280', '760')
browser('set', 'media', 'light')
assert not evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
enter('unsupported', 'sequence-first')
check_absent()
assert durable_types('sequence-first') == []
enter('sequence', 'sequence-first')
wait_modal()
assert modal_phase() != 'complete'
screenshot('after-sequence-initial')
assert durable_types('sequence-first') == ['sequence']
before = read_source()
geometry = evaluate('''(() => {
  const rect = document.querySelector("dialog[open]").getBoundingClientRect();
  return [rect.left + rect.width / 2 - innerWidth / 2, rect.top + rect.height / 2 - innerHeight / 2];
})()''')
assert geometry == [0, 0], geometry
browser('press', 'Tab')
assert evaluate('document.activeElement?.textContent.trim()') == 'Got it'
browser('press', 'Tab')
assert evaluate('document.activeElement?.getAttribute("aria-label")') == 'Close'
browser('press', 'Shift+Tab')
assert evaluate('document.activeElement?.textContent.trim()') == 'Got it'
browser('press', 'Shift+Tab')
assert evaluate('document.activeElement?.getAttribute("aria-label")') == 'Close'
evaluate('''(() => {
  window.__editorHits = [];
  for (const [selector, type] of [["#workspace-left","pointerdown"],["#workspace-right","pointerdown"],[".workspace-container > .content > div","pointerdown"],["#workspace-left","wheel"],["#workspace-right","wheel"]]) {
    document.querySelector(selector).addEventListener(type, () => window.__editorHits.push([selector,type]));
  }
  document.addEventListener("keydown", () => window.__editorHits.push("global shortcut"));
  for (const selector of ["#workspace-left .cm-content", "[role=tab][aria-selected=true]", "#workspace-right button"]) {
    document.querySelector(selector)?.focus();
    if (!document.activeElement.closest("dialog")) throw new Error("Editor accepted focus");
  }
})()''')
for x, y in [(70, 210), (1190, 230), (870, 18)]:
    browser('mouse', 'move', str(x), str(y))
    browser('mouse', 'down', 'left')
    browser('mouse', 'up', 'left')
    browser('mouse', 'wheel', '400')
browser('press', 'Control+s')
assert evaluate('window.__editorHits') == []
assert read_source() == before
complete('sequence')
screenshot('after-sequence-final')
dismiss('escape')
assert evaluate('document.activeElement?.matches("#workspace-left .cm-content")')
browser('press', 'End')
browser('keyboard', 'type', '!')
assert read_source() != before
print('PASS Sequence first after unsupported: centered, pointer/wheel/shortcut blocked, focus wraps, Escape restores source, playback completes')

enter('flowchart', 'sequence-first')
wait_modal()
assert modal_phase() != 'complete'
screenshot('after-flowchart-initial')
complete('flowchart')
screenshot('after-flowchart-final')
dismiss('confirm')
assert durable_types('sequence-first') == ['flowchart', 'sequence']
print('PASS Sequence → Flowchart: both shown independently, example source and diagram agree, Got it works after playback')

browser('set', 'media', 'light', 'reduced-motion')
assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
enter('flowchart', 'flowchart-first')
wait_modal()
assert modal_phase() == 'complete'
complete('flowchart')
screenshot('reduced-flowchart')
dismiss('close')
enter('sequence', 'flowchart-first')
wait_modal()
assert modal_phase() == 'complete'
complete('sequence')
screenshot('reduced-sequence')
dismiss('confirm')
assert durable_types('flowchart-first') == ['flowchart', 'sequence']
print('PASS Flowchart → Sequence for second account: reduced motion opens on both final views immediately')

for author in ['sequence-first', 'flowchart-first']:
    evaluate('Object.keys(localStorage).filter(k => k.startsWith("zenuml-mermaid-inline-intro-v1-")).forEach(k => localStorage.removeItem(k))')
    for kind in ['sequence', 'flowchart']:
        enter(kind, author)
        check_absent()
print('PASS New document sessions for both accounts: both seen types skip with only the mocked site properties retained')

browser('set', 'media', 'light')
enter('flowchart', 'mid-exit')
wait_modal()
assert modal_phase() != 'complete'
enter('flowchart', 'mid-exit')
check_absent()
enter('sequence', 'mid-exit')
wait_modal()
assert modal_phase() != 'complete'
dismiss('escape')
print('PASS Navigate away mid-animation: seen type skips and unseen type displays')

for method in ['close', 'confirm', 'escape']:
    for timing in ['during', 'after']:
        enter('sequence', f'{method}-{timing}')
        wait_modal()
        if timing == 'after':
            complete('sequence')
        else:
            assert modal_phase() != 'complete'
        dismiss(method)
        assert evaluate('document.activeElement?.matches("#workspace-left .cm-content")')
print('PASS Close, Got it and Escape each work during and after playback, restoring source focus')

enter('flowchart', 'toolbar-focus', delay=1800)
browser('focus', '[role=tab][aria-selected=true]')
wait_modal()
dismiss('close')
assert evaluate('document.activeElement?.matches("[role=tab][aria-selected=true]")')
print('PASS The previously focused toolbar control is restored when the property lookup completes after it received focus')

enter('editor-under-paywall', 'under-paywall')
browser('wait', '[data-testid=continue-editing-btn]')
check_absent()
assert durable_types('under-paywall') == []
screenshot('paywall-before-continue')
browser('click', '[data-testid=continue-editing-btn]')
wait_modal()
screenshot('paywall-after-continue')
assert durable_types('under-paywall') == ['flowchart']
dismiss('confirm')
print('PASS Existing paywall has priority and consumes no intro. Continue editing starts the introduction.')
