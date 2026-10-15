import { escapeHtml, formatGroupTypeList } from './utils.js';

function options(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value.id)}"${selected === value.id ? ' selected' : ''}>${escapeHtml(value.label)}</option>`).join('')}`;
}

export function addAssignmentRule(domainProject, editor) {
  const assignment = {
    personId: editor.draftAssignmentPersonId,
    eventId: editor.draftAssignmentSlotId,
    slotId: editor.draftAssignmentSlotId,
    groupTypeId: editor.draftAssignmentGroupTypeId,
  };
  if (!assignment.personId || !assignment.eventId || !assignment.groupTypeId) return 'Select a person, slot, and category.';
  const target = editor.draftAssignmentKind === 'forbidden' ? domainProject.forbiddenAssignments : domainProject.forcedAssignments;
  if (target.some((entry) => entry.personId === assignment.personId && entry.eventId === assignment.eventId && entry.groupTypeId === assignment.groupTypeId)) return 'That assignment rule already exists.';
  target.push(assignment);
  return `Added ${editor.draftAssignmentKind} assignment rule.`;
}

export function addCooldownRule(domainProject, editor) {
  const count = Number.parseInt(editor.draftCooldownCount, 10);
  if (!Number.isInteger(count) || count < 1) return 'Cooldown slot count must be at least 1.';
  domainProject.cooldownRules.push({
    triggerGroupTypes: editor.draftCooldownTriggerGroupTypeId === 'ANY' ? 'ANY' : [editor.draftCooldownTriggerGroupTypeId],
    blockedGroupTypes: editor.draftCooldownBlockedGroupTypeId === 'ANY' ? 'ANY' : [editor.draftCooldownBlockedGroupTypeId],
    blockedNextEventCount: count,
  });
  return 'Added cooldown rule.';
}

export function renderRuleEditors(domainProject, editor) {
  const people = new Map(domainProject.people.map((person) => [person.id, person.name]));
  const slots = new Map(domainProject.events.map((slot) => [slot.id, slot.slotLabel]));
  const categories = new Map(domainProject.groupTypes.map((category) => [category.id, category.label]));
  const renderAssignments = (entries, kind) => entries.length ? `<ul>${entries.map((entry, index) => `<li>${escapeHtml(people.get(entry.personId) ?? entry.personId)} → ${escapeHtml(categories.get(entry.groupTypeId) ?? entry.groupTypeId)} in ${escapeHtml(slots.get(entry.eventId) ?? entry.eventId)} <button type="button" data-remove-assignment-rule="${kind}" data-rule-index="${index}">Remove</button></li>`).join('')}</ul>` : '<p class="muted-text">None configured.</p>';
  return `
    <section class="panel">
      <h2>Forced and forbidden assignments</h2>
      <div class="form-grid four-columns compact-form-grid">
        <label>Rule<select name="draftAssignmentKind"><option value="forced"${editor.draftAssignmentKind === 'forced' ? ' selected' : ''}>Forced</option><option value="forbidden"${editor.draftAssignmentKind === 'forbidden' ? ' selected' : ''}>Forbidden</option></select></label>
        <label>Person<select name="draftAssignmentPersonId">${options(domainProject.people.map((person) => ({ id: person.id, label: person.name })), editor.draftAssignmentPersonId, 'Select person')}</select></label>
        <label>Slot<select name="draftAssignmentSlotId">${options(domainProject.events.map((slot) => ({ id: slot.id, label: `${slot.date || 'No date'} - ${slot.slotLabel}` })), editor.draftAssignmentSlotId, 'Select slot')}</select></label>
        <label>Category<select name="draftAssignmentGroupTypeId">${options(domainProject.groupTypes, editor.draftAssignmentGroupTypeId, 'Select category')}</select></label>
      </div><button type="button" data-event-staffing-action="add-assignment-rule">Add rule</button>
      <h3>Forced</h3>${renderAssignments(domainProject.forcedAssignments, 'forced')}
      <h3>Forbidden</h3>${renderAssignments(domainProject.forbiddenAssignments, 'forbidden')}
    </section>
    <section class="panel">
      <h2>Rest and spacing rules</h2>
      <p class="muted-text">A cooldown is a hard rule that prevents the same person from taking specified categories in later ordered slots. For example: after a Night assignment, block any category for the next 2 slots.</p>
      <p class="muted-text"><strong>Important:</strong> “Next slots” follows the schedule order shown in Data; it does not calculate elapsed hours or calendar days.</p>
      <div class="form-grid four-columns compact-form-grid">
        <label title="The category that starts the mandatory rest or spacing period.">After working<select name="draftCooldownTriggerGroupTypeId"><option value="ANY">Any category</option>${options(domainProject.groupTypes, editor.draftCooldownTriggerGroupTypeId, 'Select category').replace('<option value="">Select category</option>', '')}</select></label>
        <label title="The categories this person cannot work during the following ordered slots.">Prevent working<select name="draftCooldownBlockedGroupTypeId"><option value="ANY">Any category</option>${options(domainProject.groupTypes, editor.draftCooldownBlockedGroupTypeId, 'Select category').replace('<option value="">Select category</option>', '')}</select></label>
        <label title="Number of subsequent slots in schedule order, not hours or days.">For the next slots<input type="number" min="1" step="1" name="draftCooldownCount" value="${escapeHtml(editor.draftCooldownCount ?? '1')}" /></label>
        <label class="button-label">Action<button type="button" data-event-staffing-action="add-cooldown-rule">Add rest rule</button></label>
      </div>
      ${domainProject.cooldownRules.length ? `<ul>${domainProject.cooldownRules.map((rule, index) => `<li>After working ${escapeHtml(formatGroupTypeList(rule.triggerGroupTypes, categories))}, prevent this person from working ${escapeHtml(formatGroupTypeList(rule.blockedGroupTypes, categories))} in the next ${rule.blockedNextEventCount} ordered slot(s). <button type="button" data-remove-cooldown-rule data-rule-index="${index}">Remove</button></li>`).join('')}</ul>` : '<p class="muted-text">No rest or spacing rules configured. This is valid when back-to-back assignments are allowed.</p>'}
    </section>`;
}
