# Settings page shape plan

## Outcome

Turn Settings from a long card stack into a clear control center that mirrors backend permissions, keeps personal settings separate from system-wide settings, and works in English, Arabic, desktop, and narrow layouts.

## Content inventory

| Group | Current controls | Backend authority |
| --- | --- | --- |
| My profile | account identity, signing signature | signed-in user |
| Documents | stamp style, signature appearance, submitters, managers | `settings.edit`, `submitters.manage` |
| Communications | mailbox, email signature, SMS auto-send | `email.manage`, `settings.edit` |
| Access | requests and user administration | `users.manage` |
| Application | crash reporting | `settings.edit` |
| System | diagnostics, update check, v3 migration, Admin Gate | signed-in user, `system.admin` |

## Problems to solve

- Ten full-width cards create a long scroll with no wayfinding.
- Personal, operational, and administrator settings are mixed together.
- Role-based visibility disagrees with capability-based backend authorization.
- Migration and Admin Gate affordances do not match `system.admin` behavior.
- “Appearance” contains crash reporting and SMS automation rather than appearance controls.
- Placeholder-only manager and submitter inputs lack accessible names.
- Password visibility is skipped by keyboard navigation.
- Tight mobile rows and Arabic letter spacing reduce readability.

## Shape rules shared by all five mockups

- Use existing GSSG navy, red, cream, surface, border, focus, and type tokens.
- Keep red for destructive or warning states only.
- Put personal settings before application-wide settings.
- Show only sections the signed-in user can use; never offer an action the API will reject.
- Keep one dominant action per section and put destructive actions at the end.
- Use logical spacing and mirror navigation/order in RTL.
- Preserve visible labels, keyboard focus, and 44 px mobile targets.

## Five directions

1. **Document Index — recommended.** Persistent category rail plus one focused settings sheet. Best balance of official tone, scan speed, and room for complex email/signature forms.
2. **Tabbed Registry.** Horizontal category tabs with a concise overview. Familiar and compact, but tabs wrap sooner in Arabic and on narrow screens.
3. **Control Ledger.** Dense two-column setting rows with status summaries. Fast for experienced admins, but less welcoming for occasional operators.
4. **Task Panels.** Large task-oriented cards for common jobs. Strong wayfinding, but risks the generic dashboard look the product explicitly avoids.
5. **Progressive Sections.** Accordion rows with summaries and one open editor. Best mobile behavior and shortest page, but hides cross-section context.

## Recommendation

Use **Document Index**. On desktop, keep the category rail sticky and show one focused sheet. On mobile, turn the rail into a native select or compact horizontal scroller and preserve the same category order. Keep System and Advanced as separate permission-gated categories.

## Implementation boundary

This pass fixes objective capability, accessibility, RTL, and responsive defects. The selected visual direction should be implemented only after review of the five mockups.
