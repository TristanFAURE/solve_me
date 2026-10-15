export const WORKFLOW_TABS = Object.freeze([
  { id: 'setup', label: 'Setup' },
  { id: 'data', label: 'Data' },
  { id: 'rules', label: 'Rules' },
  { id: 'review', label: 'Review' },
  { id: 'results', label: 'Results' },
]);

export function isWorkflowTab(value) {
  return WORKFLOW_TABS.some((tab) => tab.id === value);
}

export function renderWorkflowTabs(activeTab, tabs = WORKFLOW_TABS) {
  return `
    <nav class="workflow-tabs" aria-label="Project workflow">
      <div role="tablist" aria-label="Workflow steps">
        ${tabs.map((tab) => `
          <button type="button" role="tab" id="workflow-tab-${tab.id}"
            aria-selected="${tab.id === activeTab ? 'true' : 'false'}"
            aria-controls="workflow-panel-${tab.id}"
            tabindex="${tab.id === activeTab ? '0' : '-1'}"
            data-workflow-tab="${tab.id}">${tab.label}</button>
        `).join('')}
      </div>
    </nav>
  `;
}

export function renderWorkflowPanel(tabId, activeTab, content) {
  return `<section id="workflow-panel-${tabId}" class="workflow-panel" role="tabpanel" aria-labelledby="workflow-tab-${tabId}"${tabId === activeTab ? '' : ' hidden'}>${content}</section>`;
}

export function bindWorkflowTabs(root, onSelect) {
  const tabs = [...root.querySelectorAll('[data-workflow-tab]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => onSelect(tab.dataset.workflowTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      const nextTabId = tabs[nextIndex].dataset.workflowTab;
      onSelect(nextTabId);
      root.querySelector(`[data-workflow-tab="${nextTabId}"]`)?.focus();
    });
  });
}
