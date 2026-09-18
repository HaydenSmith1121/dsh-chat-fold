(() => {
  const owned = Array.from(document.querySelectorAll('[data-chatfold-owned]'));
  const folded = owned.filter(e => e.hasAttribute('hidden'));
  const bars = Array.from(document.querySelectorAll('[data-chatfold-turnbar]'));
  const toggles = Array.from(document.querySelectorAll('[data-chatfold-toggle]'));
  const flows = Array.from(document.querySelectorAll('.EvIC1a_flowItem[data-chat-flow-kind]'));
  const sc = document.querySelector('.EvIC1a_scroll');
  return JSON.stringify({
    pluginLoaded: toggles.length > 0 || bars.length > 0,
    totalRows: flows.length,
    ownedRows: owned.length,
    foldedRows: folded.length,
    turnBars: bars.length,
    toggles: toggles.length,
    scrollHeight: sc ? sc.scrollHeight : null,
    sampleFolded: folded.slice(0, 5).map(e => ({
      kind: e.getAttribute('data-chat-flow-kind'),
      txt: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    })),
    visibleRows: flows.filter(e => !e.hasAttribute('hidden')).length
  }, null, 1);
})()
