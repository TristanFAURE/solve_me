import { escapeHtml, summarizeRequirements } from './utils.js';
import { renderFieldLabel } from '../../components/common/fieldHelp.js';

function renderNoSelectedEventEmptyState(domainProject) {
  return `
    <section class="workspace-panel event-staffing-detail-card">
      <div class="empty-board event-staffing-empty-state">
        <h3>No slot selected yet</h3>
        <p>Create or focus a slot to edit its date, label, and category coverage.</p>
        <ul class="empty-state-checklist">
          <li>Use the bulk creator above to generate a first schedule from a start and end date.</li>
          <li>After an event exists, select it from the browser to set its label, date, and order.</li>
          <li>${escapeHtml(domainProject.groupTypes.length > 0 ? 'Group types already exist, so you can immediately add requirements once an event is selected.' : 'You will also need at least one group type before adding staffing requirements to an event.')}</li>
        </ul>
      </div>
    </section>
  `;
}

function renderNoRequirementsHelp(domainProject) {
  if (domainProject.groupTypes.length === 0) {
    return `
      <div class="empty-board event-staffing-empty-state top-gap">
        <h4>No staffing requirements yet</h4>
        <p>This event cannot request staff until at least one reusable group type exists.</p>
        <ul class="empty-state-checklist">
          <li>Add group types in the support section below, then return here to attach min and max staffing bounds.</li>
          <li>Once group types exist, you can add a requirement here or apply the same requirement to several selected events in bulk.</li>
        </ul>
      </div>
    `;
  }

  return `
    <div class="empty-board event-staffing-empty-state top-gap">
      <h4>No staffing requirements yet</h4>
      <p>Add the first requirement for this event to define which group needs staff.</p>
      <ul class="empty-state-checklist">
        <li>Choose a group type, then set hard min and max staffing bounds.</li>
        <li>Use min = 0 when a group is optional and max to cap over-assignment.</li>
        <li>If several events should share the same pattern, use multi-select and the bulk actions section in the event browser.</li>
      </ul>
    </div>
  `;
}

export function renderSelectedEventEditor(selectedEvent, selectedRequirements, domainProject, editor, groupTypeLabelsById) {
  if (!selectedEvent) {
    return renderNoSelectedEventEmptyState(domainProject);
  }

  const totals = summarizeRequirements(selectedRequirements);
  const rows = selectedRequirements.length
    ? selectedRequirements.map((requirement, index) => `
        <tr>
          <td><span class="table-kind-badge">${escapeHtml(groupTypeLabelsById.get(requirement.groupTypeId) ?? requirement.groupTypeId)}</span></td>
          <td>${escapeHtml(String(requirement.min))}</td>
          <td>${escapeHtml(String(requirement.max))}</td>
          <td><button type="button" data-event-staffing-action="remove-requirement" data-requirement-index="${index}">Remove</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No staffing requirements yet for this event.</td></tr>';

  return `
    <section class="workspace-panel event-staffing-detail-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Selected slot</p>
          <h3>🗂️ ${escapeHtml(selectedEvent.slotLabel ?? selectedEvent.label)}</h3>
          <p class="muted-text">Edit slot metadata and category coverage without leaving the slot browser.</p>
        </div>
        <span class="panel-count">${escapeHtml(String(selectedRequirements.length))} reqs</span>
      </div>

      <dl class="summary-grid compact-summary-grid">
        <div><dt>Date</dt><dd>${escapeHtml(selectedEvent.date || 'Not set')}</dd></div>
        <div><dt>Order</dt><dd>${escapeHtml(String(selectedEvent.orderIndex + 1))}</dd></div>
        <div><dt>Total min</dt><dd>${escapeHtml(String(totals.totalMin))}</dd></div>
        <div><dt>Total max</dt><dd>${escapeHtml(String(totals.totalMax))}</dd></div>
      </dl>

      <div class="stacked-form-sections top-gap">
        <section>
          <h4>✏️ Slot details</h4>
          <div class="form-grid three-columns compact-form-grid">
            <label>${renderFieldLabel('Slot label', 'The planner-facing name for this independently staffed time slot.')}<input type="text" name="draftSelectedEventLabel" value="${escapeHtml(editor.draftSelectedEventLabel)}" /></label>
            <label>${renderFieldLabel('Date', 'Groups this slot with other slots on the same day in calendars and results.')}<input type="date" name="draftSelectedEventDate" value="${escapeHtml(editor.draftSelectedEventDate)}" /></label>
            <label>${renderFieldLabel('Order index', 'Zero-based schedule position used by rest and spacing rules. It does not represent elapsed hours.')}<input type="number" name="draftSelectedEventOrderIndex" value="${escapeHtml(editor.draftSelectedEventOrderIndex)}" min="0" step="1" /></label>
          </div>
          <div class="event-staffing-inline-actions top-gap">
            <button type="button" data-event-staffing-action="save-selected-event">Save slot details</button>
          </div>
        </section>

        <section>
          <div class="section-summary-row">
              <h4>🧱 Insert slot</h4>
            <span class="section-count-pill">Around ${escapeHtml(selectedEvent.label)}</span>
          </div>
          <div class="form-grid three-columns compact-form-grid">
            <label>${renderFieldLabel('Slot label', 'Name of the new independently staffed slot.')}<input type="text" name="draftInsertedEventLabel" value="${escapeHtml(editor.draftInsertedEventLabel)}" placeholder="New slot label" /></label>
            <label>${renderFieldLabel('Date', 'Calendar date used to group this slot in availability views and schedule results.')}<input type="date" name="draftInsertedEventDate" value="${escapeHtml(editor.draftInsertedEventDate)}" /></label>
            <label>
              ${renderFieldLabel('Position', 'Insert the new slot immediately before or after the focused slot in schedule order.')}
              <select name="draftInsertedEventPosition">
                <option value="before"${editor.draftInsertedEventPosition === 'before' ? ' selected' : ''}>Before selected event</option>
                <option value="after"${editor.draftInsertedEventPosition === 'after' ? ' selected' : ''}>After selected event</option>
              </select>
            </label>
          </div>
          <div class="event-staffing-inline-actions top-gap">
            <button type="button" data-event-staffing-action="insert-event-near-selection">Insert slot</button>
            <button type="button" class="ghost-danger-button" data-event-staffing-action="delete-focused-event">Delete focused slot</button>
          </div>
        </section>

        <section>
          <div class="section-summary-row">
            <h4>👥 Staffing requirements</h4>
            <span class="section-count-pill">${escapeHtml(String(selectedRequirements.length))} configured</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Group type</th><th>Min</th><th>Max</th><th>Action</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${selectedRequirements.length === 0 ? renderNoRequirementsHelp(domainProject) : ''}
        </section>

        <section>
          <h4>➕ Add requirement</h4>
          ${domainProject.groupTypes.length > 0 ? `
            <div class="form-grid four-columns compact-form-grid">
              <label>
                ${renderFieldLabel('Group type', 'Reusable staffing category required in this slot.')}
                <select name="draftRequirementGroupTypeId">
                  <option value="">Select group type</option>
                  ${domainProject.groupTypes.map((groupType) => `<option value="${escapeHtml(groupType.id)}"${editor.draftRequirementGroupTypeId === groupType.id ? ' selected' : ''}>${escapeHtml(groupType.label)}</option>`).join('')}
                </select>
              </label>
              <label>${renderFieldLabel('Min', 'Hard minimum staffing. For example, 0 makes this category optional; 3 requires at least three people in the slot.')}<input type="number" name="draftRequirementMin" value="${escapeHtml(editor.draftRequirementMin)}" min="0" step="1" /></label>
              <label>${renderFieldLabel('Max', 'Hard staffing cap. For example, 1 allows one person; 5 allows up to five people in this category and slot.')}<input type="number" name="draftRequirementMax" value="${escapeHtml(editor.draftRequirementMax)}" min="0" step="1" /></label>
              <label class="button-label">Action<button type="button" data-event-staffing-action="add-requirement">Add to selected event</button></label>
            </div>
          ` : `
            <div class="empty-board event-staffing-empty-state">
              <p>Add a reusable group type before creating staffing requirements for this event.</p>
            </div>
          `}
        </section>

      </div>
    </section>
  `;
}
