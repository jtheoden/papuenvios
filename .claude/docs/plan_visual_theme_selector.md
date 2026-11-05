# Plan: selectable default visual theme (classic / papuenvios)

## Request
Keep the PapuEnvios palette as a SECOND built-in default theme next to the current blue/violet look, and let
a super_admin pick which one is the site default from Settings > Visual.

## Facts verified in the code
- `business_visual_settings.settings` is `jsonb` (migration 20260119000002): a new key needs NO migration.
- `loadVisualSettings` merges `{ ...DEFAULT_VISUAL_SETTINGS, ...row }`, so a default for a new key fills old rows.
- `headerTheme`, `footerTheme`, `loadingTheme` and the inline Home CTAs (there is no `homeTheme` module) decide
  legacy vs brand by VALUES (`useGradient`), not by a theme name. `BRAND_PRESET` sets `useGradient:false`.
- The Visual tab is reachable by `isAdmin`; RLS lets `admin` and `super_admin` write the row. Only the
  "Sistema" tab is super_admin-only. So "only super_admin" is enforced in the UI (prop from `SettingsPage`).
- `updateAppearance` with live preview ON calls `setVisualSettings`, which persists (debounced). This is the
  known auto-persist risk.

## Options
A. `activeTheme` as a pure label. Rejected: it can disagree with the values the resolvers read.
B. `activeTheme` + resolvers read the name. Rejected: rewrites four consumers, risks prod look, no gain.
C. (chosen) `activeTheme` + presets applied over the form, plus a snapshot so classic is restorable.
   Resolvers stay value-driven, so they resolve exactly as today for both themes.

## Decision
- New optional keys in `settings`: `activeTheme: 'classic' | 'papuenvios'` and `classicSnapshot` (object).
  Absent or invalid `activeTheme` is INFERRED from the values (revision 2): every `BRAND_PRESET` value present
  (hex compared case-insensitively) => `papuenvios`, anything else => `classic`. `DEFAULT_VISUAL_SETTINGS` must NOT
  define `activeTheme`, or the merge in `loadVisualSettings` would make every row look explicitly classic.
  Why: the owner already saved the brand palette with the old button, so the real production row (2026-11-05)
  holds all 38 preset keys and neither `activeTheme` nor `classicSnapshot`. Inference shows it as papuenvios
  and makes clicking Classico a real switch (no snapshot => classic preset defaults).
- `src/lib/visualThemes.js` (pure): `THEME_IDS`, `resolveThemeId`, `THEME_PRESETS`, `selectTheme(form, id)`.
  - classic preset = the `DEFAULT_VISUAL_SETTINGS` values for the keys of `BRAND_PRESET` (no duplicated literals).
  - classic -> papuenvios: stores `classicSnapshot` = the form's current values for the preset keys (unless they
    already equal the brand values), applies `BRAND_PRESET`, sets `activeTheme`.
  - papuenvios -> classic: restores `classicSnapshot` (sanitized: only preset keys, valid HEX / boolean), falling
    back to the classic preset per key; drops the snapshot; sets `activeTheme`.
  - Keys outside the preset (`primaryColor`, `secondaryColor`, logo, texts, carousel...) are never touched, so the
    admin's customisations survive both directions.
- UI (`SettingsPageVisual`): the "Aplicar paleta PapuEnvios" button becomes a `radiogroup` of two cards (name,
  description, colour swatches, "in use" text badge for the SAVED theme, check icon on the selected card).
  Selecting fills the FORM only and turns live preview off; the live-preview checkbox is disabled while a theme
  change is pending, so a later edit cannot persist it. Persisted only by "Guardar Personalización".
  The harmless undo is now "Deshacer eleccion de tema".
  "Restablecer tema de fabrica" (revision 2) is destructive: visible only with `canChangeTheme`, asks confirmation
  with the project's Radix AlertDialog, and `restoreThemeDefaults` resets every non-content key to the code
  defaults while keeping `CONTENT_KEYS` (logo, favicon, texts, home features, carousel) and unknown keys.
  A notice appears when preset colours were edited by hand (`getThemeDeviations`).
- Permissions: `canChangeTheme` prop (= `isSuperAdmin`); default false => radios disabled + explanation.
- i18n: new keys under `settings.visual.brand.theme.*` in ES and EN (usted), parity test extended.

## Risks
- UI-only gate: an `admin` could still write `activeTheme` via the API (RLS is role-level, not key-level).
  A key-level DB trigger/lock is out of scope by owner decision; documented, not built. An admin can also
  reproduce either theme by hand with the colour pickers, so the gate is a convenience, not a security boundary.
- e2e `PROD_ROW` copies in `header-brand.spec.js` / `footer-brand.spec.js` are CLASSIC test rows (the pre-brand
  production look), not today's production row. Unit fixture: `src/tests/fixtures/classicVisualRow.js`.
- Cached settings (1 min, localStorage) keep the previous theme up to a minute on other tabs/devices.
- The theme only changes values at selection time; manual colour edits afterwards keep the label but diverge
  from the preset (shown as the selected theme + customised values; acceptable, documented in the UI hint).

## Stages (each: test red -> implement -> re-read -> verify)
1. `visualThemes.js` + unit tests (selectTheme round trips, sanitize, defaults, parity of classic preset with DEFAULT).
2. Service tests (absent key stays absent and resolves from values, saved key survives load).
3. Theme parity tests: header/footer/loading resolvers with the classic row, the real brand row and the preset, before and after selectTheme.
4. UI selector + tests (a11y, form-only, permissions, save payload, round trip) replacing the preset button tests.
5. Translations + parity test; lint, vitest, build; tracking docs.
