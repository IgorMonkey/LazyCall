const assert = require('node:assert/strict');

/** Geometry audit shared by the product UI fixtures; it does not mutate layout. */
exports.checkSpacing = async (page, view, scopeSelector) => {
  const measured = await page.evaluate(scopeSelector => {
    const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
    const shown = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const issues = []; let controls = 0, icons = 0;
    const transcriptPane = document.querySelector('.conversation');
    const assistantPane = document.querySelector('.assistant-pane');
    if (transcriptPane && assistantPane && shown(transcriptPane) && shown(assistantPane)) {
      const left = transcriptPane.getBoundingClientRect(), right = assistantPane.getBoundingClientRect();
      if (Math.abs(left.top - right.top) < 1 && right.left >= left.right - 1) {
        for (const [a, b, name] of [
          ['.quick-notes', '.assistant-composer', 'composer boundaries'],
          ['.quick-notes-heading', '.composer-label', 'field labels'],
          ['.quick-notes > textarea', '#assistant-question', 'text fields'],
          ['.quick-notes-actions', '.composer-actions', 'action rows']
        ]) {
          const first = document.querySelector(a), second = document.querySelector(b);
          if (!first || !second) { issues.push(`${name}: missing paired element`); continue; }
          const x = first.getBoundingClientRect(), y = second.getBoundingClientRect();
          // A translated label can wrap; its top and the shared field row must align.
          if (Math.abs(x.top - y.top) > 1 || (name !== 'field labels' && Math.abs(x.bottom - y.bottom) > 1)) issues.push(`${name}: paired panes do not align (${x.top}–${x.bottom} vs ${y.top}–${y.bottom})`);
        }
      }
    }
    const header = document.querySelector('.app-header');
    for (const dialog of scope.querySelectorAll('dialog[open]')) {
      const bounds = dialog.getBoundingClientRect();
      for (const element of dialog.querySelectorAll(':scope > .settings-heading, :scope > .settings-actions')) {
        const box = element.getBoundingClientRect();
        if (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) issues.push(`${dialog.className}: title or actions leave dialog bounds`);
      }
    }
    if (header) for (const node of header.querySelectorAll('.brand, .meeting-heading, .header-actions, .header-actions > .button, .header-more-trigger')) {
      if (!shown(node)) continue;
      const box = node.getBoundingClientRect(), bounds = header.getBoundingClientRect();
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.left < 0 || box.right > innerWidth + 1) issues.push(`${node.className}: header content clips at viewport edge`);
    }
    for (const button of scope.querySelectorAll('.button, .icon-button, .ui-select')) {
      if (!shown(button)) continue;
      controls++;
      const box = button.getBoundingClientRect(), style = getComputedStyle(button);
      const label = (button.getAttribute('aria-label') || button.textContent).trim().slice(0, 60);
      if (box.width < 20 || box.height < 20) issues.push(`${label}: unusable control bounds`);
      for (const icon of button.querySelectorAll(':scope > svg.icon')) {
        icons++;
        const rect = icon.getBoundingClientRect();
        if (Math.abs(rect.y + rect.height / 2 - box.y - box.height / 2) > 1) issues.push(`${label}: icon box is off center`);
        const ink = icon.getBBox(), matrix = icon.getScreenCTM();
        const point = new DOMPoint(ink.x + ink.width / 2, ink.y + ink.height / 2).matrixTransform(matrix);
        if (Math.abs(point.y - rect.y - rect.height / 2) > 1) issues.push(`${label}: icon drawing is off center`);
        if (button.classList.contains('button') && !button.classList.contains('button-text') && (parseFloat(style.paddingLeft) < 8 || parseFloat(style.columnGap) < 6)) issues.push(`${label}: missing icon/label padding`);
      }
      if (box.right > button.parentElement.getBoundingClientRect().right + 2) issues.push(`${label}: control overflows its row`);
    }
    for (const group of scope.querySelectorAll('.header-actions, .assistant-toolbar, .composer-actions, .result-controls, .settings-actions, .materials-section-heading, .project-row, .capture-controls')) {
      if (!shown(group)) continue;
      const children = [...group.children].filter(node => shown(node) && node.tagName !== 'DIALOG' && !['absolute', 'fixed'].includes(getComputedStyle(node).position));
      for (let i = 1; i < children.length; i++) {
        const a = children[i - 1].getBoundingClientRect(), b = children[i].getBoundingClientRect();
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        if (sameRow && b.left - a.right < 3.5) issues.push(`${group.className}: adjacent content touches or overlaps`);
      }
    }
    for (const panel of scope.querySelectorAll('.assistant-pane, .materials-body, .settings-body, .projects-body, .results-body')) {
      if (shown(panel) && panel.scrollWidth > panel.clientWidth + 1) issues.push(`${panel.className}: horizontal overflow`);
    }
    return { controls, icons, issues };
  }, scopeSelector);
  assert.deepEqual(measured.issues, [], `${view}: spacing audit`);
  return { view, controls: measured.controls, icons: measured.icons };
};
