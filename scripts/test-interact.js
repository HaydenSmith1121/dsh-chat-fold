(() => {
  const results = [];
  const rows = Array.from(document.querySelectorAll('[data-chatfold-owned]'));
  const sc = document.querySelector('.EvIC1a_scroll');

  // 1. baseline folded count
  results.push('folded=' + rows.filter(r => r.hasAttribute('hidden')).length + '/' + rows.length);
  results.push('scrollH=' + (sc ? sc.scrollHeight : -1));

  // 2. expand one row via its own toggle
  const first = rows[0];
  const btn = first.querySelector('[data-chatfold-toggle]');
  btn.click();
  results.push('afterClickFirst: hidden=' + first.hasAttribute('hidden') + ' aria=' + btn.getAttribute('aria-expanded'));
  results.push('scrollH_afterOne=' + (sc ? sc.scrollHeight : -1));

  // 3. expand all via the turn bar
  const bar = document.querySelector('[data-chatfold-turnbar] button');
  bar.click();
  results.push('afterBarExpand: folded=' + rows.filter(r => r.hasAttribute('hidden')).length + '/' + rows.length);
  results.push('scrollH_expanded=' + (sc ? sc.scrollHeight : -1));
  results.push('barText=' + bar.textContent);

  // 4. collapse all again
  bar.click();
  results.push('afterBarCollapse: folded=' + rows.filter(r => r.hasAttribute('hidden')).length + '/' + rows.length);
  results.push('scrollH_recollapsed=' + (sc ? sc.scrollHeight : -1));
  results.push('barText2=' + bar.textContent);

  return JSON.stringify(results, null, 1);
})()
