(function () {
  'use strict';
  function getLabels(callback) {
    chrome.storage.local.get('ecohelp_labels', (result) => {
      callback(result.ecohelp_labels || {});
    });
  }
  function saveLabels(labels) {
    chrome.storage.local.set({ ecohelp_labels: labels });
  }
  function getEcoId(anchor) {
    const match =
      anchor.href?.match(/(ECOHELP-\d+)/) ||
      anchor.textContent.match(/(ECOHELP-\d+)/);
    return match ? match[1] : null;
  }
  function createAddBtn(ecoId) {
    const btn = document.createElement('span');
    btn.className = 'ecohelp-add-btn';
    btn.textContent = '+';
    btn.dataset.ecoId = ecoId;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      promptLabel(ecoId);
    });
    return btn;
  }
  function createBadge(text, ecoId) {
    const badge = document.createElement('span');
    badge.className = 'ecohelp-label-badge';
    badge.textContent = text;
    badge.dataset.ecoId = ecoId;
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      promptLabel(ecoId);
    });
    return badge;
  }
  function applyLabels() {
    getLabels((labels) => {
      const anchors = document.querySelectorAll('a');
      anchors.forEach((a) => {
        const id = getEcoId(a);
        if (!id) return;
        if (a.textContent.trim() !== id) return;
        const next = a.nextElementSibling;
        if (
          next?.classList?.contains('ecohelp-label-badge') ||
          next?.classList?.contains('ecohelp-add-btn')
        ) return;
        if (labels[id]) {
          a.after(createBadge(labels[id], id));
        } else {
          a.after(createAddBtn(id));
        }
      });
    });
  }
  function promptLabel(ecoId) {
    getLabels((labels) => {
      const current = labels[ecoId] || '';
      const input = prompt(
        'Label for ' + ecoId + ':\n(leave empty to remove)',
        current
      );
      if (input === null) return;
      if (input.trim() === '') {
        delete labels[ecoId];
      } else {
        labels[ecoId] = input.trim();
      }
      saveLabels(labels);
      document
        .querySelectorAll('.ecohelp-add-btn, .ecohelp-label-badge')
        .forEach((el) => el.remove());
      applyLabels();
    });
  }
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyLabels, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(applyLabels, 2000);
  applyLabels();
})();
