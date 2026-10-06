import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(fileURLToPath(new URL('../../apps/web/src/styles.css', import.meta.url)), 'utf8');
const mainEntry = readFileSync(fileURLToPath(new URL('../../apps/web/src/main.tsx', import.meta.url)), 'utf8');
const assignmentScreen = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/bootstrap/DeviceRoleAssignmentScreen.tsx', import.meta.url)), 'utf8');

describe('accessible UI styles', () => {
  it('publishes a measured viewport height for WebViews that report zero viewport units', () => {
    expect(mainEntry).toContain("--app-viewport-height");
    expect(mainEntry).toContain('window.innerHeight');
    expect(mainEntry).toContain("addEventListener('resize'");
    expect(styles).toMatch(/:root \{[^}]*--app-viewport-height: 100vh;/s);
    expect(styles).toMatch(/\.app-frame \{[^}]*min-height: var\(--app-viewport-height\);/s);
    expect(styles).toMatch(/\.bootstrap-login-screen \{[^}]*min-height: var\(--app-viewport-height\);/s);
    expect(styles).toMatch(/\.station-assignment-card \{[^}]*height: calc\(var\(--app-viewport-height\) - 32px\);/s);
  });

  it('keeps station targets primary and exposes Admin as a compact accessible header action', () => {
    expect(assignmentScreen).toContain('className="station-assignment-header"');
    expect(assignmentScreen).toMatch(/className="icon-button station-assignment-admin"[^>]*aria-label=\{t\('stationAssignment\.openAdmin'\)\}[^>]*title=\{t\('stationAssignment\.openAdmin'\)\}/s);
    expect(assignmentScreen).toMatch(/<Settings2[^>]*aria-hidden="true"/s);

    const cardRule = styles.match(/\.station-assignment-card \{[^}]*\}/s)?.[0] ?? '';
    const headerRule = styles.match(/\.station-assignment-header \{[^}]*\}/s)?.[0] ?? '';
    const listRule = styles.match(/\.station-assignment-list \{[^}]*\}/s)?.[0] ?? '';
    const adminRule = styles.match(/\.station-assignment-admin \{[^}]*\}/s)?.[0] ?? '';

    expect(cardRule).toContain('display: flex;');
    expect(cardRule).toContain('height: calc(var(--app-viewport-height) - 32px);');
    expect(headerRule).toContain('grid-template-columns: auto minmax(0, 1fr) auto;');
    expect(listRule).toContain('flex: 1 1 auto;');
    expect(listRule).toContain('min-height: 0;');
    expect(adminRule).toContain('margin-top: 0;');
    expect(adminRule).toContain('width: 48px;');
  });

  it('lays station targets out as a responsive grid without crowding the square kiosk', () => {
    expect(styles).toMatch(/\.station-assignment-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@media \(min-width: 1101px\) \{[\s\S]*?\.station-assignment-list \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@media \(max-width: 520px\) and \(max-height: 520px\) \{[\s\S]*?\.station-assignment-list \{[^}]*grid-template-columns: 1fr;/s);

    const targetRule = styles.match(/\.station-assignment-target \{[^}]*\}/s)?.[0] ?? '';
    expect(targetRule).toContain('min-height: 64px;');
    expect(targetRule).toContain('width: 100%;');
  });

  it('keeps station role cards scoped to the bootstrap login and touch-friendly', () => {
    expect(styles).toMatch(/\.bootstrap-login-card \.station-role-option \{[^}]*align-items: center;[^}]*justify-content: center;[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/\.bootstrap-login-card \.station-role-option \{[^}]*text-align: center;/s);
    expect(styles).toMatch(/@media \(max-width: 520px\) and \(max-height: 520px\) \{[\s\S]*?\.bootstrap-login-card \.station-role-option \{[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/@media \(min-width: 721px\) \{[\s\S]*?\.bootstrap-login-card \.station-role-picker__options \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
  });

  it('keeps primary interactive controls at touch-friendly sizes', () => {
    expect(styles).toMatch(/\.button \{[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/\.text-button \{[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/\.touch-select__trigger \{[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/\.modal-card__close \{[^}]*min-height: 48px;/s);
    expect(styles).toMatch(/\.overview-refresh \{[^}]*min-height: 48px;[^}]*min-width: 48px;/s);
    expect(styles).toMatch(/\.date-picker__trigger \{[^}]*min-height: 48px;/s);
  });

  it('keeps ROOM saver weather larger, lower, and scrollable on short viewports', () => {
    const contentRule = styles.match(/\.room-screensaver__content \{[^}]*\}/s)?.[0] ?? '';
    const weatherRule = styles.match(/\.room-screensaver__weather \{[^}]*\}/s)?.[0] ?? '';
    const valueRule = styles.match(/\.room-screensaver__weather-value \{[^}]*\}/s)?.[0] ?? '';
    const iconRule = styles.match(/\.room-screensaver__weather-icon \{[^}]*\}/s)?.[0] ?? '';

    expect(contentRule).toContain('max-height: 100%;');
    expect(contentRule).toContain('overflow-y: auto;');
    expect(weatherRule).toContain('margin-top: clamp(44px, 7vh, 72px);');
    expect(valueRule).toContain('font-size: clamp(1.75rem, 5vw, 3rem);');
    expect(iconRule).toContain('height: clamp(68px, 15vw, 112px);');
  });

  it('styles compact AREA request metadata and keeps DND room lists scrollable', () => {
    const roomRule = styles.match(/\.queue-card__room \{[^}]*\}/s)?.[0] ?? '';
    const metadataRule = styles.match(/\.queue-card__metadata \{[^}]*\}/s)?.[0] ?? '';
    const labelRule = styles.match(/\.queue-card__created,\s*\.queue-card__age \{[^}]*\}/s)?.[0] ?? '';
    const labelFontSize = Number(labelRule.match(/font-size: ([\d.]+)rem/)?.[1] ?? 0);

    expect(roomRule).toContain('font-size: 1.2rem;');
    expect(roomRule).toContain('font-weight: 900;');
    expect(metadataRule).toContain('display: flex;');
    expect(metadataRule).toContain('flex-wrap: wrap;');
    expect(labelRule).toContain('.queue-card__created, .queue-card__age');
    expect(labelFontSize).toBeGreaterThanOrEqual(0.8);
    expect(labelRule).toContain('color: var(--muted);');
    expect(labelRule).toContain('font-variant-numeric: tabular-nums;');
    expect(labelRule).toContain('white-space: nowrap;');
    expect(styles).toMatch(/\.area-dnd-strip \{[^}]*overflow-x: auto;/s);
    expect(styles).not.toMatch(/\.queue-card__drag-handle\b|\.queue-card--dragging\b|\.queue-column--drag-over\b|\.queue-complete-drop-zone\b/);
  });

  it('adds a small gap between AREA request titles and their action buttons', () => {
    const titleRule = styles.match(/\.queue-card h3 \{[^}]*\}/s)?.[0] ?? '';

    expect(titleRule).toContain('margin: 14px 0 10px;');
  });

  it('styles AREA DND room chips as compact red cards with white labels and icons', () => {
    const roomRule = styles.match(/\.area-dnd-room \{[^}]*\}/s)?.[0] ?? '';
    const iconRule = styles.match(/\.area-dnd-room svg \{[^}]*\}/s)?.[0] ?? '';
    const nameRule = styles.match(/\.area-dnd-room span \{[^}]*\}/s)?.[0] ?? '';

    expect(roomRule).toContain('background: #a94d3a;');
    expect(roomRule).toContain('border: 1px solid #a94d3a;');
    expect(roomRule).toContain('color: #fff;');
    expect(roomRule).toContain('min-height: 36px;');
    expect(roomRule).toContain('padding: 4px 8px;');
    expect(iconRule).toContain('color: inherit;');
    expect(nameRule).toContain('color: inherit;');
  });

  it('colors DND room and tab badges by activation age and keeps unknown times neutral', () => {
    const severityColors = {
      gray: '#495057',
      yellow: '#785700',
      red: '#a94d3a',
      unknown: '#70777a'
    };

    for (const [severity, color] of Object.entries(severityColors)) {
      const roomRule = styles.match(new RegExp(`\\.area-dnd-room--${severity} \\{[^}]*\\}`))?.[0] ?? '';
      const countRule = styles.match(new RegExp(`\\.area-dnd-tab-count--${severity} \\{[^}]*\\}`))?.[0] ?? '';
      expect(roomRule).toContain(`background: ${color};`);
      expect(roomRule).toContain('color: #fff;');
      expect(countRule).toContain(`background: ${color};`);
      expect(countRule).toContain('color: #fff;');
    }
  });

  it('styles the AREA No molestar count badge with a red background and white number', () => {
    const badgeRule = styles.match(/\.area-dnd-tab-count \{[^}]*\}/s)?.[0] ?? '';

    expect(badgeRule).toContain('background: #a94d3a;');
    expect(badgeRule).toContain('color: #fff;');
    expect(badgeRule).toContain('display: inline-flex;');
    expect(badgeRule).toContain('border-radius: 999px;');
  });

  it('uses two AREA queue columns on desktop and tablets, and one on phones', () => {
    expect(styles).toMatch(/\.queue-board \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@media \(max-width: 980px\) \{[\s\S]*?\.queue-board \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.queue-board \{[^}]*grid-template-columns: 1fr;/s);
    expect(styles).toMatch(/\.device-layout--area \{[^}]*min-width: 0;/s);
  });

  it('keeps the AREA console viewport fixed and scrolls each request column independently', () => {
    const areaFrameRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \{[^}]*\}/s)?.[0] ?? '';
    const areaContentRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-content \{[^}]*\}/s)?.[0] ?? '';
    const areaLayoutRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-layout--area \{[^}]*\}/s)?.[0] ?? '';
    const requestSectionRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-layout--area > section\[aria-label\] \{[^}]*\}/s)?.[0] ?? '';
    const queueBoardRule = styles.match(/\.queue-board \{[^}]*\}/s)?.[0] ?? '';
    const queueColumnRule = styles.match(/\.queue-column \{[^}]*\}/s)?.[0] ?? '';
    const queueBodyRule = styles.match(/\.queue-column__body \{[^}]*\}/s)?.[0] ?? '';

    expect(areaFrameRule).toContain('display: flex;');
    expect(areaFrameRule).toContain('flex-direction: column;');
    expect(areaFrameRule).toContain('height: var(--app-viewport-height);');
    expect(areaFrameRule).toContain('overflow: hidden;');
    expect(areaContentRule).toContain('flex: 1;');
    expect(areaContentRule).toContain('min-height: 0;');
    expect(areaContentRule).toContain('min-width: 0;');
    expect(areaContentRule).toContain('overflow: hidden;');
    expect(areaContentRule).toContain('width: 100%;');
    expect(areaLayoutRule).toContain('flex: 1;');
    expect(areaLayoutRule).toContain('min-height: 0;');
    expect(requestSectionRule).toContain('display: flex;');
    expect(requestSectionRule).toContain('min-height: 0;');
    expect(queueBoardRule).toContain('flex: 1 1 0;');
    expect(queueBoardRule).toContain('min-height: 0;');
    expect(queueColumnRule).toContain('display: flex;');
    expect(queueColumnRule).toContain('flex-direction: column;');
    expect(queueColumnRule).toContain('overflow: hidden;');
    expect(queueBodyRule).toContain('flex: 1 1 0;');
    expect(queueBodyRule).toContain('min-height: 0;');
    expect(queueBodyRule).toContain('overflow-y: auto;');
    expect(queueBodyRule).toContain('overscroll-behavior: contain;');
    expect(styles).not.toMatch(/\.app-frame--room \.queue-column__body \{[^}]*overflow-y: auto;/s);
    expect(styles).not.toMatch(/\.app-frame--admin \.queue-column__body \{[^}]*overflow-y: auto;/s);
  });

  it('keeps the AREA topbar sticky and compact and gives selected tabs a darker fill and accent underline', () => {
    const topbarRule = styles.match(/\.topbar--area \{[^}]*\}/s)?.[0] ?? '';
    const areaFilterRowRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.filter-row \{[^}]*\}/s)?.[0] ?? '';
    const areaFilterPillRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.filter-pill \{[^}]*\}/s)?.[0] ?? '';
    const activeFilterRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.filter-pill--active \{[^}]*\}/s)?.[0] ?? '';
    const completedQueueRule = styles.match(/\.queue-board--completed \{[^}]*\}/s)?.[0] ?? '';

    expect(topbarRule).toContain('position: sticky;');
    expect(topbarRule).toContain('top: 0;');
    expect(topbarRule).toContain('padding: 6px 0;');
    expect(topbarRule).toContain('z-index: 30;');
    expect(topbarRule).toContain('width: 100%;');
    expect(topbarRule).toContain('min-width: 0;');
    expect(topbarRule).not.toContain('max-width:');
    expect(areaFilterRowRule).toContain('flex-wrap: nowrap;');
    expect(areaFilterRowRule).toContain('width: 100%;');
    expect(areaFilterPillRule).toContain('flex: 1 1 0;');
    expect(areaFilterPillRule).toContain('min-width: 0;');
    expect(areaFilterPillRule).toContain('border: 0;');
    expect(areaFilterPillRule).toContain('border-radius: 0;');
    expect(activeFilterRule).toContain('background: #ded6c7;');
    expect(activeFilterRule).toContain('border-bottom-color: var(--coral);');
    expect(activeFilterRule).toContain('color: var(--ink);');
    expect(activeFilterRule).not.toContain('background: var(--ink);');
    expect(areaFilterPillRule).toContain('border-bottom: 3px solid transparent;');
    expect(styles).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.app-frame--device:not\(\.app-frame--room\) \.filter-pill:not\(\.filter-pill--active\):hover \{/s);
    expect(styles).not.toMatch(/\.app-frame--device:not\(\.app-frame--room\) \.filter-pill:hover/);
    expect(completedQueueRule).toContain('grid-template-columns: minmax(0, 1fr);');
  });

  it('keeps the AREA DND panel surface consistent with the queue panels', () => {
    const dndPanelRule = styles.match(/\.area-dnd-strip \{[^}]*\}/s)?.[0] ?? '';

    expect(dndPanelRule).toContain('background: rgba(247, 244, 235, 0.68);');
    expect(dndPanelRule).toContain('border-top: 3px solid var(--muted);');
    expect(dndPanelRule).toContain('padding: 13px;');
    expect(dndPanelRule).toContain('overflow-x: auto;');
  });

  it('keeps completed request search and ordering controls responsive and keyboard-visible', () => {
    const toolbarRule = styles.match(/\.completed-requests-toolbar \{[^}]*\}/s)?.[0] ?? '';
    const searchRule = styles.match(/\.completed-requests-toolbar__search \{[^}]*\}/s)?.[0] ?? '';
    const sortSummaryRule = styles.match(/\.completed-requests-toolbar__sort summary \{[^}]*\}/s)?.[0] ?? '';
    const focusRule = styles.match(/\.completed-requests-toolbar :focus-visible \{[^}]*\}/s)?.[0] ?? '';
    const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'), styles.indexOf('@media (min-width: 721px)'));
    const mobileToolbarRule = mobileStyles.match(/\.completed-requests-toolbar \{[^}]*\}/s)?.[0] ?? '';

    expect(toolbarRule).toContain('display: flex;');
    expect(toolbarRule).toContain('min-width: 0;');
    expect(searchRule).toContain('flex: 1 1 auto;');
    expect(searchRule).toContain('min-width: 0;');
    expect(sortSummaryRule).toContain('cursor: pointer;');
    expect(focusRule).toContain('outline: 2px solid var(--coral);');
    expect(mobileToolbarRule).toContain('align-items: stretch;');
    expect(mobileToolbarRule).toContain('flex-direction: column;');
  });

  it('compacts AREA spacing on desktop and mobile while suppressing tap highlight', () => {
    const areaFrameRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \{[^}]*\}/s)?.[0] ?? '';
    const areaContentRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-content \{[^}]*\}/s)?.[0] ?? '';
    const areaTopbarRule = styles.match(/\.topbar--area \{[^}]*\}/s)?.[0] ?? '';
    const globalButtonRule = styles.match(/^button \{[^}]*\}/m)?.[0] ?? '';
    const keyboardFocusRule = styles.match(/button:focus-visible, input:focus-visible, select:focus-visible, dialog:focus-visible \{[^}]*\}/s)?.[0] ?? '';
    const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'), styles.indexOf('@media (min-width: 721px)'));
    const mobileFrameRule = mobileStyles.match(/\.app-frame--device:not\(\.app-frame--room\) \{[^}]*\}/s)?.[0] ?? '';
    const mobileContentRule = mobileStyles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-content \{[^}]*\}/s)?.[0] ?? '';

    expect(areaFrameRule).toContain('padding-top: 4px;');
    expect(areaFrameRule).toContain('padding-bottom: 4px;');
    expect(areaContentRule).toContain('padding: 4px 0 0;');
    expect(areaTopbarRule).toContain('background: #e3ded2;');
    expect(globalButtonRule).toContain('-webkit-tap-highlight-color: transparent;');
    expect(keyboardFocusRule).toContain('outline: 3px solid rgba(204, 132, 40, 0.55);');
    expect(mobileFrameRule).toContain('padding-top: 4px;');
    expect(mobileFrameRule).toContain('padding-bottom: 4px;');
    expect(mobileContentRule).toContain('padding-top: 4px;');
  });

  it('keeps AREA notices in a floating status stack and lets empty queues collapse', () => {
    const areaStatusRule = styles.match(/\.area-status-stack \{[^}]*\}/s)?.[0] ?? '';
    const areaLayoutRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-content \{[^}]*\}/s)?.[0] ?? '';
    const areaDeviceRule = styles.match(/\.app-frame--device:not\(\.app-frame--room\) \.device-layout \{[^}]*\}/s)?.[0] ?? '';
    const queueColumnRule = styles.match(/\.queue-column \{[^}]*\}/s)?.[0] ?? '';

    expect(areaStatusRule).toContain('position: fixed;');
    expect(areaStatusRule).toContain('pointer-events: none;');
    expect(areaLayoutRule).toContain('padding:');
    expect(areaDeviceRule).toContain('gap:');
    expect(queueColumnRule).not.toContain('min-height: 240px;');
  });

  it('provides bounded overlay and listbox surfaces', () => {
    expect(styles).toMatch(/\.modal-scrim \{[^}]*overflow-y: auto;/s);
    expect(styles).toMatch(/\.modal-card \{[^}]*max-height:/s);
    expect(styles).toMatch(/\.touch-select__menu \{[^}]*max-height:/s);
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('lets shared modal cards size to content without clipping open selectors', () => {
    const modalRule = styles.match(/\.modal-card \{[^}]*\}/s)?.[0] ?? '';

    expect(modalRule).toContain('height: auto;');
    expect(modalRule).toContain('max-height: 100%;');
    expect(modalRule).toContain('overflow: visible;');
    expect(modalRule).not.toContain('overflow-y: auto;');
    expect(modalRule).not.toMatch(/\d+d?vh/);
  });

  it('keeps modal overlays above the Admin navigation stacking layer', () => {
    const adminShellRule = styles.match(/\.admin-shell \{[^}]*\}/s)?.[0] ?? '';
    const modalScrimRule = styles.match(/\.modal-scrim \{[^}]*\}/s)?.[0] ?? '';

    expect(adminShellRule).not.toContain('z-index:');
    expect(modalScrimRule).toContain('position: fixed;');
    expect(modalScrimRule).toContain('z-index: 40;');
  });

  it('fades the Information carousel without moving the room layout and disables motion when requested', () => {
    expect(styles).toMatch(/\.information-carousel \{[^}]*animation: information-carousel-fade-in 180ms ease both;[^}]*position: absolute;/s);
    expect(styles).toContain('@keyframes information-carousel-fade-in');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.information-carousel \{\s*animation: none;\s*\}/s);
  });

  it('insets Information carousel content from the bottom while preserving its full-surface overlay', () => {
    const carouselRule = styles.match(/\.information-carousel \{[^}]*\}/s)?.[0] ?? '';

    expect(carouselRule).toContain('inset: 0;');
    expect(carouselRule).toContain('padding-bottom: clamp(16px, 3vh, 32px);');
  });

  it('keeps Information heading actions touch-friendly and the timing modal bounded', () => {
    const actionsRule = styles.match(/\.information-panel__heading-actions \{[^}]*\}/s)?.[0] ?? '';
    const actionRule = styles.match(/\.information-panel__heading-action \{[^}]*\}/s)?.[0] ?? '';
    const timingRule = styles.match(/\.information-panel__timing \{[^}]*\}/s)?.[0] ?? '';
    const modalRule = styles.match(/\.information-settings-modal \{[^}]*\}/s)?.[0] ?? '';

    expect(actionsRule).toContain('align-items: center;');
    expect(actionsRule).toContain('display: flex;');
    expect(actionsRule).toContain('flex: 0 0 auto;');
    expect(actionRule).toContain('min-height: 48px;');
    expect(actionRule).toContain('min-width: 48px;');
    expect(timingRule).toContain('display: grid;');
    expect(timingRule).toContain('gap: 16px;');
    expect(modalRule).toContain('max-width: 520px;');
  });

  it('defines a distinct destructive action state', () => {
    expect(styles).toMatch(/\.button--danger \{[^}]*background:/s);
  });

  it('lets application shells use the full available width', () => {
    expect(styles).toMatch(/\.app-frame \{[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.topbar \{[^}]*max-width: none;/s);
    expect(styles).toMatch(/\.admin-shell \{[^}]*max-width: none;/s);
    expect(styles).toMatch(/\.device-content \{[^}]*max-width: none;/s);
  });

  it('keeps the Admin sidebar visible and horizontally operable at compact widths', () => {
    expect(styles).toMatch(/\.admin-mobile-nav \{[^}]*display: none;/s);
    const compactStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'));

    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-sidebar \{[^}]*display: block;[^}]*overflow-x: auto;/s);
    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-nav \{[^}]*display: flex;[^}]*min-width: max-content;/s);
    expect(compactStyles).toMatch(/\.admin-mobile-nav \{[^}]*display: none;/s);
  });

  it('keeps the mobile Admin frame clear of its sticky topbar and horizontal sidebar', () => {
    const compactStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'));

    expect(compactStyles).toMatch(/\.app-frame--admin \.topbar--admin \{[^}]*position: sticky;[^}]*top: 0;/s);
    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-sidebar \{[^}]*padding:/s);
    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-main \{[^}]*padding-bottom: 0;/s);
  });

  it('gives desktop Admin a sticky command header and framed operations canvas', () => {
    const desktopStyles = styles.slice(styles.indexOf('@media (min-width: 981px)'));

    expect(desktopStyles).toMatch(/\.app-frame--admin \.topbar--admin \{[^}]*position: sticky;[^}]*top: 12px;[^}]*z-index: 30;/s);
    expect(desktopStyles).toMatch(/\.admin-sidebar \{[^}]*position: sticky;[^}]*top: 96px;[^}]*background: var\(--paper\);/s);
    expect(desktopStyles).toMatch(/\.admin-main__canvas \{[^}]*background: var\(--paper\);[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;/s);
    expect(desktopStyles).toMatch(/\.app-frame--admin \.metric-card \{[^}]*border: 1px solid var\(--line\);[^}]*box-shadow:/s);
  });

  it('keeps compact Admin navigation labels on one scrollable row', () => {
    const compactStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'));

    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-nav__item \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/s);
    expect(compactStyles).toMatch(/\.app-frame--admin \.admin-nav__item--active \{[^}]*border-left: 0;[^}]*border-bottom: 3px solid var\(--coral\);/s);
  });

  it('styles setup accordions and counters as compact badges', () => {
    const setupAccordionRule = styles.match(/\.setup-accordion__trigger \{[^}]*\}/s)?.[0] ?? '';
    const setupCountRule = styles.match(/\.setup-accordion__count \{[^}]*\}/s)?.[0] ?? '';

    expect(setupAccordionRule).toContain('align-items: center;');
    expect(setupAccordionRule).toContain('display: flex;');
    expect(setupCountRule).toContain('background: var(--amber);');
    expect(setupCountRule).toContain('display: inline-flex;');
  });

  it('keeps date-picker grids and branding upload controls accessible and bounded', () => {
    const popoverRule = styles.match(/\.date-picker__popover \{[^}]*\}/s)?.[0] ?? '';
    const dayRule = styles.match(/\.date-picker__day \{[^}]*\}/s)?.[0] ?? '';
    const fileRule = styles.match(/\.branding-file-input \{[^}]*\}/s)?.[0] ?? '';
    const uploadRule = styles.match(/\.branding-upload-button \{[^}]*\}/s)?.[0] ?? '';

    expect(popoverRule).toContain('position: absolute;');
    expect(popoverRule).toContain('z-index:');
    expect(dayRule).toContain('min-height: 40px;');
    expect(dayRule).toContain('min-width: 40px;');
    expect(fileRule).toContain('position: absolute;');
    expect(uploadRule).toContain('min-height: 40px;');
    expect(uploadRule).toContain('min-width: 40px;');
  });

  it('uses the available desktop queue filter space and setup tab treatment for statuses', () => {
    const queueFilterRule = styles.match(/\.queue-filter-grid \{[^}]*\}/s)?.[0] ?? '';

    expect(queueFilterRule).toContain('grid-template-columns: repeat(3, minmax(120px, 1fr));');
    expect(styles).toContain('.setup-tabs');
    expect(styles).toContain('.setup-tab');
    expect(styles).toContain('.setup-tab--active');
    expect(styles).toContain('.setup-tab__label');

    const tabletStyles = styles.slice(styles.indexOf('@media (max-width: 980px)'));
    const phoneStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'));
    expect(tabletStyles).toMatch(/\.queue-filter-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(phoneStyles).toMatch(/\.queue-filter-grid \{[^}]*grid-template-columns: 1fr;/s);
  });

  it('keeps Admin searches flexible between headings and counts', () => {
    const headingRule = styles.match(/\.catalog-card \.panel-card__heading, \.device-management \.panel-card__heading \{[^}]*\}/s)?.[0] ?? '';
    const searchRule = styles.match(/\.catalog-search \{[^}]*\}/s)?.[0] ?? '';

    expect(headingRule).toContain('align-items: center;');
    expect(headingRule).toContain('display: flex;');
    expect(searchRule).toContain('flex: 1 1 auto;');
    expect(searchRule).toContain('min-width: 0;');
  });

  it('keeps Admin configuration actions icon-sized and inline with their items', () => {
    const catalogRowRule = styles.match(/\.catalog-row \{[^}]*\}/s)?.[0] ?? '';
    const catalogActionsRule = styles.match(/\.catalog-row__actions \{[^}]*\}/s)?.[0] ?? '';
    const deviceRowRule = styles.match(/\.device-row \{[^}]*\}/s)?.[0] ?? '';
    const deviceActionsRule = styles.match(/\.device-row__actions \{[^}]*\}/s)?.[0] ?? '';
    const itemActionRule = styles.match(/\.admin-item-action \{[^}]*\}/s)?.[0] ?? '';

    expect(catalogRowRule).toContain('align-items: center;');
    expect(catalogRowRule).toContain('display: flex;');
    expect(catalogActionsRule).toContain('display: flex;');
    expect(catalogActionsRule).toContain('flex-wrap: nowrap;');
    expect(deviceRowRule).toContain('flex-wrap: wrap;');
    expect(deviceActionsRule).toContain('flex-wrap: nowrap;');
    expect(deviceActionsRule).toContain('overflow-x: auto;');
    expect(itemActionRule).toContain('min-height: 40px;');
    expect(itemActionRule).toContain('min-width: 40px;');
  });

  it('keeps the language selector compact and its icon content aligned', () => {
    expect(styles).toMatch(/\.language-selector \{[^}]*width:/s);
    expect(styles).toMatch(/\.language-selector > label \{[^}]*clip-path:/s);
    expect(styles).toMatch(/\.touch-select__value \{[^}]*display: flex;/s);
    expect(styles).toMatch(/\.touch-select__option-icon \{[^}]*display: inline-flex;/s);
  });

  it('anchors the language menu to the right of its selector', () => {
    expect(styles).toMatch(/\.language-selector \.touch-select__menu \{[^}]*left: 0;[^}]*right: auto;/s);
  });

  it('keeps the language selector above surrounding interface surfaces', () => {
    const languageSelectorRule = styles.match(/\.language-selector \{[^}]*\}/s)?.[0] ?? '';
    expect(languageSelectorRule).toContain('position: relative;');
    expect(languageSelectorRule).toContain('z-index: 1000;');
  });

  it('keeps the room navbar sticky without changing the admin navbar', () => {
    expect(styles).toMatch(/\.app-frame--room \{[^}]*height: var\(--app-viewport-height\);[^}]*min-height: var\(--app-viewport-height\);[^}]*overflow: hidden;/s);
    expect(styles).toMatch(/\.topbar--room \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index:/s);
    expect(styles).toMatch(/\.room-request-button__icon--unread \{[^}]*color:/s);
  });

  it('distributes the ROOM navbar across left, flexible middle, and right tracks', () => {
    const roomTopbarRule = styles.match(/\.topbar--room \{[^}]*\}/s)?.[0] ?? '';
    const roomIdentityTrackRule = styles.match(/\.topbar--room \.topbar__identity \{[^}]*\}/s)?.[0] ?? '';
    const roomIdentityRule = styles.match(/\.topbar--room \.room-identity \{[^}]*\}/s)?.[0] ?? '';
    const roomActionsRule = styles.match(/\.topbar--room \.topbar__actions \{[^}]*\}/s)?.[0] ?? '';

    expect(roomTopbarRule).toContain('display: grid;');
    expect(roomTopbarRule).toContain('align-items: center;');
    expect(roomTopbarRule).toContain('grid-template-columns: auto minmax(0, 1fr) auto;');
    expect(roomTopbarRule).toContain('width: 100%;');
    expect(roomIdentityTrackRule).toContain('grid-column: 1;');
    expect(roomIdentityTrackRule).toContain('justify-self: start;');
    expect(roomIdentityTrackRule).toContain('align-items: center;');
    expect(roomIdentityRule).toContain('grid-column: 2;');
    expect(roomIdentityRule).toContain('justify-self: center;');
    expect(roomIdentityRule).toContain('align-items: center;');
    expect(roomActionsRule).toContain('grid-column: 3;');
    expect(roomActionsRule).toContain('align-items: center;');
    expect(roomActionsRule).toContain('justify-self: end;');
    expect(roomActionsRule).toContain('width: auto;');
  });

  it('keeps the ROOM language trigger text-only with a visible keyboard focus ring', () => {
    const languageTriggerRule = styles.match(/\.app-frame--room \.language-selector \.touch-select__trigger \{[^}]*\}/s)?.[0] ?? '';
    const languageFocusRule = styles.match(/\.app-frame--room \.language-selector \.touch-select__trigger:focus-visible \{[^}]*\}/s)?.[0] ?? '';
    const languageChevronRule = styles.match(/\.app-frame--room \.language-selector \.touch-select__chevron \{[^}]*\}/s)?.[0] ?? '';

    expect(languageTriggerRule).toContain('background: transparent;');
    expect(languageTriggerRule).toContain('border: 0;');
    expect(languageTriggerRule).toContain('box-shadow: none;');
    expect(languageFocusRule).toContain('outline:');
    expect(languageFocusRule).toContain('outline-offset:');
    expect(languageChevronRule).toContain('display: none;');
  });

  it('keeps ROOM navigation and service containers backgroundless', () => {
    const roomTopbarRule = styles.match(/\.topbar--room \{[^}]*\}/s)?.[0] ?? '';
    const bottomControlsRule = styles.match(/\.app-frame--room \.room-bottom-controls \{[^}]*\}/s)?.[0] ?? '';
    const servicesSurfaceRule = styles.match(/\.app-frame--room \.room-services-section \{[^}]*\}/s)?.[0] ?? '';

    expect(roomTopbarRule).toContain('background: transparent;');
    expect(roomTopbarRule).toContain('backdrop-filter: none;');
    expect(bottomControlsRule).toContain('background: transparent;');
    expect(bottomControlsRule).toContain('backdrop-filter: none;');
    expect(servicesSurfaceRule).toContain('background: transparent;');
    expect(servicesSurfaceRule).toContain('backdrop-filter: none;');
  });

  it('places ROOM bell and Admin at the ends with a flexible DND middle track', () => {
    const bottomControlsRule = styles.match(/\.room-bottom-controls \{[^}]*\}/s)?.[0] ?? '';
    const requestControlRule = styles.match(/\.room-request-control \{[^}]*\}/s)?.[0] ?? '';
    const dndControlRule = styles.match(/\.app-frame--room \.room-dnd-control \{[^}]*\}/s)?.[0] ?? '';
    const dndButtonRule = styles.match(/\.app-frame--room \.room-dnd-button \{[^}]*\}/s)?.[0] ?? '';
    const actionsRule = styles.match(/\.room-bottom-controls__actions \{[^}]*\}/s)?.[0] ?? '';

    expect(bottomControlsRule).toContain('display: grid;');
    expect(bottomControlsRule).toContain('grid-template-columns: auto minmax(0, 1fr) auto;');
    expect(requestControlRule).toContain('justify-content: flex-start;');
    expect(dndControlRule).toContain('justify-self: stretch;');
    expect(dndControlRule).toContain('width: 100%;');
    expect(dndButtonRule).toContain('width: 100%;');
    expect(actionsRule).toContain('justify-content: flex-end;');
    expect(actionsRule).toContain('width: auto;');
  });

  it('separates ROOM services from the lower navigation', () => {
    const bottomControlsRule = styles.match(/\.app-frame--room \.room-bottom-controls \{[^}]*\}/s)?.[0] ?? '';

    expect(bottomControlsRule).toContain('border-top: 1px solid var(--line);');
  });

  it('gives ROOM an appliance-like surface hierarchy and compact labels', () => {
    const roomContentRule = styles.match(/\.app-frame--room \.device-content \{[^}]*\}/s)?.[0] ?? '';
    const servicesSurfaceRule = styles.match(/\.app-frame--room \.room-services-section \{[^}]*\}/s)?.[0] ?? '';
    const serviceTileRule = styles.match(/\.app-frame--room \.service-tile \{[^}]*\}/s)?.[0] ?? '';
    const serviceLabelRule = styles.match(/\.app-frame--room \.service-tile__body strong \{[^}]*\}/s)?.[0] ?? '';

    expect(roomContentRule).toContain('background: transparent;');
    expect(servicesSurfaceRule).toContain('background: transparent;');
    expect(servicesSurfaceRule).toContain('border: 1px solid var(--line);');
    expect(serviceTileRule).toContain('border-radius: 5px;');
    expect(serviceTileRule).toContain('background: var(--room-tile);');
     expect(styles).toContain('--room-tile: rgba(35, 47, 48, 0.18);');
    expect(serviceTileRule).toContain('box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06);');
    expect(serviceLabelRule).toContain('font-family: inherit;');
    expect(serviceLabelRule).toContain('font-weight: 800;');
  });

  it('gives ROOM an obsidian surface with local gradient layers', () => {
    const roomFrameRule = styles.match(/\.app-frame--room \{[^}]*\}/s)?.[0] ?? '';
    const servicesSurfaceRule = styles.match(/\.app-frame--room \.room-services-section \{[^}]*\}/s)?.[0] ?? '';

    expect(roomFrameRule).toContain('--room-bg:');
    expect(roomFrameRule).toContain('background-color: var(--room-bg);');
    expect(roomFrameRule).toMatch(/background-image:\s*(?:radial|linear)-gradient/);
    expect(servicesSurfaceRule).toContain('backdrop-filter: none;');
    expect(styles).not.toMatch(/\.app-frame--admin \{[^}]*--room-bg:/s);
  });

  it('uses translucent backgrounds for every visible ROOM control button', () => {
    const roomFrameRule = styles.match(/\.app-frame--room \{[^}]*\}/s)?.[0] ?? '';
    const requestButtonRule = styles.match(/\.app-frame--room \.room-request-button \{[^}]*\}/s)?.[0] ?? '';
    const dndButtonRule = styles.match(/\.room-dnd-button \{[^}]*\}/s)?.[0] ?? '';
    const activeDndButtonRule = styles.match(/\.room-dnd-button--active \{[^}]*\}/s)?.[0] ?? '';
    const adminButtonRule = styles.match(/\.app-frame--room \.room-bottom-controls__actions \.button \{[^}]*\}/s)?.[0] ?? '';
    const serviceTileRule = styles.match(/\.app-frame--room \.service-tile \{[^}]*\}/s)?.[0] ?? '';

    expect(roomFrameRule).toMatch(/--room-button-bg:\s*rgba\([^)]*\);/);
    expect(roomFrameRule).toMatch(/--room-dnd-off-bg:\s*rgba\([^)]*\);/);
    expect(roomFrameRule).toMatch(/--room-dnd-on-bg:\s*rgba\([^)]*\);/);
    expect(requestButtonRule).toContain('background: var(--room-button-bg);');
    expect(dndButtonRule).toContain('background: var(--room-dnd-off-bg);');
    expect(activeDndButtonRule).toContain('background: var(--room-dnd-on-bg);');
    expect(adminButtonRule).toContain('background: var(--room-button-bg);');
    expect(serviceTileRule).toContain('background: var(--room-tile);');
  });

  it('renders dynamic ROOM areas as a horizontal service-tile rail', () => {
    const areaGridRule = styles.match(/\.room-area-grid \{[^}]*\}/s)?.[0] ?? '';
    const areaCardRule = styles.match(/\.room-area-card \{[^}]*\}/s)?.[0] ?? '';
    const areaRoomCardRule = styles.match(/\.app-frame--room \.room-area-card \{[^}]*\}/s)?.[0] ?? '';
    const areaRailRule = styles.match(/\.room-area-scroll-rail \{[^}]*\}/s)?.[0] ?? '';
    const areaHintRule = styles.match(/\.room-area-scroll-hint \{[^}]*\}/s)?.[0] ?? '';

    expect(areaGridRule).toContain('display: flex;');
    expect(areaGridRule).toContain('flex-wrap: nowrap;');
    expect(areaGridRule).toContain('overflow-x: auto;');
    expect(areaGridRule).toContain('overflow-y: hidden;');
    expect(areaCardRule).toContain('flex: 0 0');
    expect(areaRoomCardRule).toContain('background: var(--room-area-card-surface);');
    expect(areaRailRule).toContain('position: relative;');
    expect(areaHintRule).toContain('pointer-events: none;');
    expect(areaHintRule).toContain('position: absolute;');
    expect(styles).not.toContain('.room-area-card__index');
    expect(styles).not.toContain('.room-area-card__arrow');
  });

  it('sizes ROOM area pages against the usable rail viewport', () => {
    const areaRailRule = styles.match(/\.room-area-scroll-rail \{[^}]*\}/s)?.[0] ?? '';
    const areaGridRule = styles.match(/\.room-area-grid \{[^}]*\}/s)?.[0] ?? '';
    const squareKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const squareKioskStyles = styles.slice(squareKioskStart, reducedMotionStart);
    const areaPageRule = squareKioskStyles.match(/\.app-frame--room \.room-area-page \{[^}]*\}/s)?.[0] ?? '';
    const tabletStart = styles.indexOf('@media (min-width: 521px) and (max-width: 1100px) and (max-height: 900px)');
    const tabletStyles = styles.slice(tabletStart, reducedMotionStart);
    const tabletAreaPageRule = tabletStyles.match(/\.app-frame--room \.room-area-page \{[^}]*\}/s)?.[0] ?? '';

    expect(areaRailRule).toContain('padding: clamp(8px, 1.5vw, 20px);');
    expect(areaGridRule).toContain('padding: 0;');
    expect(areaGridRule).not.toContain('padding: clamp(8px, 1.5vw, 20px);');
    expect(areaGridRule).toContain('gap: 12px;');
    expect(areaPageRule).toContain('flex: 0 0 100%;');
    expect(tabletAreaPageRule).toContain('flex: 0 0 100%;');
    expect(tabletStyles).toMatch(/\.app-frame--room \.room-area-page \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/s);
  });

  it('gives ordered ROOM area tiles distinct translucent Glass tints with aligned hover and fallback surfaces', () => {
    const roomFrameRule = styles.match(/\.app-frame--room \{[^}]*\}/s)?.[0] ?? '';
    const areaCardRule = styles.match(/\.app-frame--room \.room-area-card \{[^}]*\}/s)?.[0] ?? '';
    const tintRules = ['amber', 'teal', 'coral', 'blue'].map((tint) => styles.match(new RegExp(`\\.app-frame--room \\.room-area-card--${tint} \\{[^}]*\\}`, 's'))?.[0] ?? '');
    const hoverRule = styles.match(/\.app-frame--room \.room-area-card:hover \{[^}]*\}/s)?.[0] ?? '';
    const fallbackStyles = styles.slice(styles.indexOf('@supports not (backdrop-filter: blur(1px))'));
    const compactKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const compactKioskStyles = styles.slice(compactKioskStart, reducedMotionStart);

    expect(roomFrameRule).toContain('--room-area-card-bg: rgba(35, 47, 48, 0.34);');
    expect(roomFrameRule).toContain('--room-area-card-bg-fallback: #232f30;');
    expect(roomFrameRule).toContain('--room-area-card-hover-bg: rgba(35, 47, 48, 0.52);');
    expect(roomFrameRule).toContain('--room-area-card-hover-bg-fallback: #304143;');
    for (const tint of ['amber', 'teal', 'coral', 'blue']) {
      expect(roomFrameRule).toContain(`--room-area-card-${tint}-bg:`);
      expect(roomFrameRule).toContain(`--room-area-card-${tint}-bg-fallback:`);
      expect(roomFrameRule).toContain(`--room-area-card-${tint}-hover-bg:`);
      expect(roomFrameRule).toContain(`--room-area-card-${tint}-hover-bg-fallback:`);
    }
    expect(areaCardRule).toContain('--room-area-card-surface: var(--room-area-card-bg);');
    expect(areaCardRule).toContain('--room-area-card-surface-fallback: var(--room-area-card-bg-fallback);');
    expect(areaCardRule).toContain('--room-area-card-hover-surface: var(--room-area-card-hover-bg);');
    expect(areaCardRule).toContain('--room-area-card-hover-surface-fallback: var(--room-area-card-hover-bg-fallback);');
    expect(areaCardRule).toContain('backdrop-filter: blur(12px);');
    expect(areaCardRule).toContain('background: var(--room-area-card-surface);');
    expect(hoverRule).toContain('background: var(--room-area-card-hover-surface);');
    expect(tintRules).toHaveLength(4);
    for (const [index, tint] of ['amber', 'teal', 'coral', 'blue'].entries()) {
      expect(tintRules[index]).toContain(`--room-area-card-surface: var(--room-area-card-${tint}-bg);`);
      expect(tintRules[index]).toContain(`--room-area-card-surface-fallback: var(--room-area-card-${tint}-bg-fallback);`);
      expect(tintRules[index]).toContain(`--room-area-card-hover-surface: var(--room-area-card-${tint}-hover-bg);`);
      expect(tintRules[index]).toContain(`--room-area-card-hover-surface-fallback: var(--room-area-card-${tint}-hover-bg-fallback);`);
    }
    expect(fallbackStyles).toContain('.app-frame--room .room-area-card { background: var(--room-area-card-surface-fallback); }');
    expect(fallbackStyles).toContain('.app-frame--room .room-area-card:hover { background: var(--room-area-card-hover-surface-fallback); }');
    expect(compactKioskStyles).toMatch(/\.app-frame--room \.room-area-card \{[^}]*min-width: 0;/s);
    expect(compactKioskStyles).not.toContain('background: var(--room-tile);');
  });

  it('keeps the ROOM area modal bounded to horizontally paged 2x2 service targets', () => {
    const modalRule = styles.match(/\.app-frame--room \.room-area-services-modal \{[^}]*\}/s)?.[0] ?? '';
    const viewportRule = styles.match(/\.room-area-services__viewport \{[^}]*\}/s)?.[0] ?? '';
    const serviceGridRule = styles.match(/\.room-area-services__grid \{[^}]*\}/s)?.[0] ?? '';
    const servicePageRule = styles.match(/\.room-area-services__page \{[^}]*\}/s)?.[0] ?? '';

    expect(modalRule).toContain('max-width: 640px;');
    expect(modalRule).toContain('width: min(640px, calc(100vw - 32px));');
    expect(viewportRule).toContain('max-height:');
    expect(viewportRule).toContain('overflow-x: auto;');
    expect(viewportRule).toContain('overflow-y: hidden;');
    expect(viewportRule).toContain('overscroll-behavior: contain;');
    expect(viewportRule).toContain('touch-action: pan-x;');
    expect(serviceGridRule).toContain('display: flex;');
    expect(serviceGridRule).toContain('min-width: 100%;');
    expect(servicePageRule).toContain('flex: 0 0 100%;');
    expect(servicePageRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(servicePageRule).toContain('grid-template-rows: repeat(2, minmax(0, 1fr));');
  });

  it('removes ROOM bottom padding so the bottom controls reach the kiosk edge', () => {
    const roomFrameRule = styles.match(/\.app-frame--room \{[^}]*\}/s)?.[0] ?? '';
    const roomContentRule = styles.match(/\.app-frame--room \.device-content \{[^}]*\}/s)?.[0] ?? '';
    const compactLayoutStart = styles.indexOf('@media (max-width: 720px)');
    const squareKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const compactLayoutStyles = styles.slice(compactLayoutStart, squareKioskStart);

    expect(roomFrameRule).toContain('padding-bottom: 0;');
    expect(roomContentRule).toContain('padding-bottom: 0;');
    expect(compactLayoutStyles).toMatch(/\.app-frame--room \{[^}]*padding-bottom: 0;/s);
  });

  it('anchors the ROOM request panel above and to the right of the bottom bell', () => {
    const scrimRule = styles.match(/\.room-request-status-scrim \{[^}]*\}/s)?.[0] ?? '';
    const panelRule = styles.match(/\.room-request-status-modal \{[^}]*\}/s)?.[0] ?? '';

    expect(scrimRule).toContain('align-items: flex-end;');
    expect(scrimRule).toContain('justify-content: flex-start;');
    expect(scrimRule).toContain('padding-bottom:');
    expect(panelRule).toContain('margin: 0;');
  });

  it('bounds the ROOM request panel and scrolls its status list internally', () => {
    const panelRule = styles.match(/\.room-request-status-modal \{[^}]*\}/s)?.[0] ?? '';
    const statusPanelRule = styles.match(/\.room-request-status-panel \{[^}]*\}/s)?.[0] ?? '';

    expect(panelRule).toContain('max-height: min(520px, calc(100dvh - 132px));');
    expect(panelRule).toContain('overflow: hidden;');
    expect(panelRule).toContain('width: min(430px, 100%);');
    expect(statusPanelRule).toContain('max-height: min(360px, calc(100dvh - 260px));');
    expect(statusPanelRule).toContain('overflow-y: auto;');
  });

  it('centers and balances the ROOM service confirmation modal', () => {
    const modalRule = styles.match(/\.app-frame--room \.room-service-confirmation-modal \{[^}]*\}/s)?.[0] ?? '';
    const confirmationRule = styles.match(/\.room-service-confirmation \{[^}]*\}/s)?.[0] ?? '';
    const iconRule = styles.match(/\.room-service-confirmation__icon \{[^}]*\}/s)?.[0] ?? '';
    const actionsRule = styles.match(/\.room-service-confirmation__actions \{[^}]*\}/s)?.[0] ?? '';

    expect(modalRule).toContain('max-width: 430px;');
    expect(modalRule).toContain('width: min(430px, calc(100vw - 32px));');
    expect(modalRule).toContain('text-align: center;');
    expect(confirmationRule).toContain('display: grid;');
    expect(confirmationRule).toContain('justify-items: center;');
    expect(confirmationRule).toContain('text-align: center;');
    expect(iconRule).toContain('height: 72px;');
    expect(iconRule).toContain('width: 72px;');
    expect(actionsRule).toContain('justify-content: center;');
    expect(actionsRule).toContain('width: 100%;');
  });

  it('scopes readable confirmation spacing to the Admin confirmation modal', () => {
    const modalRule = styles.match(/\.admin-confirmation-modal \{[^}]*\}/s)?.[0] ?? '';
    const copyRule = styles.match(/\.admin-confirmation-modal \.modal-card__copy \{[^}]*\}/s)?.[0] ?? '';
    const actionsRule = styles.match(/\.admin-confirmation-modal \.form-actions \{[^}]*\}/s)?.[0] ?? '';

    expect(modalRule).toContain('max-width: 440px;');
    expect(modalRule).toContain('width: min(440px, calc(100vw - 32px));');
    expect(modalRule).toContain('text-align: center;');
    expect(copyRule).toContain('font-size: 0.86rem;');
    expect(copyRule).toContain('line-height: 1.55;');
    expect(copyRule).toContain('text-align: center;');
    expect(actionsRule).toContain('gap: 12px;');
    expect(actionsRule).toContain('justify-content: center;');
  });

  it('uses a modal backdrop for the language selector without changing regular selects', () => {
    const backdropRule = styles.match(/\.touch-select__backdrop \{[^}]*\}/s)?.[0] ?? '';
    const modalSelectRule = styles.match(/\.touch-select--modal \{[^}]*\}/s)?.[0] ?? '';

    expect(backdropRule).toContain('inset: 0;');
    expect(backdropRule).toContain('position: fixed;');
    expect(backdropRule).toContain('pointer-events: auto;');
    expect(modalSelectRule).toContain('z-index: 1000;');
  });

  it('raises only the open TouchSelect above later modal siblings', () => {
    const openSelectRule = styles.match(/\.touch-select--open \{[^}]*\}/s)?.[0] ?? '';
    const modalMenuRule = styles.match(/\.touch-select--modal \.touch-select__menu \{[^}]*\}/s)?.[0] ?? '';

    expect(openSelectRule).toContain('position: relative;');
    expect(openSelectRule).toContain('z-index: 1001;');
    expect(modalMenuRule).toContain('max-height: 240px;');
    expect(styles).toContain('.touch-select:has(.touch-select__trigger[aria-expanded="true"])');
  });

  it('lets the room service grid shrink to the viewport width', () => {
    expect(styles).toMatch(/\.app-frame--room \.device-content \{[^}]*min-height: 0;[^}]*min-width: 0;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.app-frame--room \.device-layout--room \{[^}]*min-width: 0;/s);
    expect(styles).toMatch(/\.room-services-section \{[^}]*min-width: 0;/s);
  });

  it('keeps the assigned room identity visible in compact ROOM layouts', () => {
    expect(styles).toMatch(/\.topbar__identity \{[^}]*display: flex;[^}]*min-width: 0;/s);
    expect(styles).toMatch(/\.topbar__actions \{[^}]*display: flex;[^}]*min-width: 0;/s);
    expect(styles).toMatch(/\.topbar__actions \{[^}]*border-left: 1px solid var\(--line\);[^}]*padding-left: 22px;/s);
    expect(styles).toMatch(/\.topbar--room \{[^}]*display: grid;[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/s);
    expect(styles).toMatch(/\.topbar--room \.room-identity \{[^}]*grid-column: 2;[^}]*justify-self: center;/s);
    expect(styles).toMatch(/\.topbar--room \.topbar__actions \{[^}]*grid-column: 3;[^}]*justify-self: end;/s);
    expect(styles).not.toMatch(/\.app-frame--room \.station-context \{[^}]*display: block;/s);
  });

  it('keeps the complete room service grid inside a bounded viewport', () => {
    const viewportRule = styles.match(/\.service-pages \{[^}]*\}/s)?.[0] ?? '';
    const pageRule = styles.match(/\.service-page \{[^}]*\}/s)?.[0] ?? '';

    expect(viewportRule).toContain('overflow: hidden;');
    expect(viewportRule).toContain('touch-action: pan-y;');
    expect(viewportRule).not.toContain('overflow-x: auto;');
    expect(viewportRule).not.toContain('scroll-snap-type:');
    expect(viewportRule).not.toContain('scroll-behavior:');
    expect(pageRule).toContain('inset: 0;');
    expect(pageRule).toContain('position: absolute;');
    expect(pageRule).toContain('width: 100%;');
    expect(pageRule).toContain('pointer-events: none;');
    expect(pageRule).not.toContain('scroll-snap-align:');
    expect(pageRule).not.toContain('scroll-snap-stop:');
    expect(pageRule).not.toContain('transform: scale(');
    expect(styles).toMatch(/\.service-pages__track \{[^}]*height: 100%;[^}]*position: absolute;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.app-frame--room \.service-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*grid-template-rows: repeat\(3, minmax\(0, 1fr\)\);[^}]*height: 100%;[^}]*width: 100%;/s);
    expect(styles).not.toContain('.service-overflow');
  });

  it('uses deterministic lateral fade motion with an explicit reduced-motion state', () => {
    const trackRule = styles.match(/\.service-pages__track \{[^}]*\}/s)?.[0] ?? '';
    const pageRule = styles.match(/\.service-page \{[^}]*\}/s)?.[0] ?? '';
    const previousPageRule = styles.match(/\.service-page--previous \{[^}]*\}/s)?.[0] ?? '';
    const activePageRule = styles.match(/\.service-page--active \{[^}]*\}/s)?.[0] ?? '';
    const nextPageRule = styles.match(/\.service-page--next \{[^}]*\}/s)?.[0] ?? '';
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const reducedMotionStyles = styles.slice(reducedMotionStart);

    expect(trackRule).toContain('transition: transform 180ms ease-out;');
    expect(pageRule).toContain('opacity: 0.24;');
    expect(pageRule).toContain('pointer-events: none;');
    expect(pageRule).toContain('transition: opacity 180ms ease-out, transform 180ms ease-out;');
    expect(previousPageRule).toContain('transform: translateX(-100%);');
    expect(activePageRule).toContain('opacity: 1;');
    expect(activePageRule).toContain('transform: translateX(0);');
    expect(activePageRule).toContain('pointer-events: auto;');
    expect(nextPageRule).toContain('transform: translateX(100%);');
    expect(reducedMotionStyles).toMatch(/\.service-pages__track \{[^}]*transition: none;/s);
    expect(reducedMotionStyles).toMatch(/\.service-page, \.service-page--previous, \.service-page--active, \.service-page--next \{[^}]*transition: none;/s);
    expect(reducedMotionStyles).not.toContain('opacity: 1; transform: none;');
  });

  it('uses one shared ROOM obsidian theme for service, request-status, and admin login modals', () => {
    const roomModalRule = styles.match(/\.room-modal \{[^}]*\}/s)?.[0] ?? '';
    const primaryButtonRule = styles.match(/\.room-modal \.button--primary \{[^}]*\}/s)?.[0] ?? '';
    const emptyStateRule = styles.match(/\.room-modal \.empty-state \{[^}]*\}/s)?.[0] ?? '';
    const inputRule = styles.match(/\.room-modal \.form-field input, \.room-modal \.form-field select \{[^}]*\}/s)?.[0] ?? '';

    expect(roomModalRule).toContain('--room-modal-surface:');
    expect(roomModalRule).toContain('--room-modal-ink:');
    expect(roomModalRule).toContain('background: var(--room-modal-surface);');
    expect(roomModalRule).toContain('border: 1px solid var(--room-modal-line);');
    expect(primaryButtonRule).toContain('background: var(--room-modal-primary-bg);');
    expect(primaryButtonRule).toContain('color: var(--room-modal-primary-ink);');
    expect(emptyStateRule).toContain('background: var(--room-modal-empty-bg);');
    expect(emptyStateRule).not.toContain('rgba(247, 244, 235');
    expect(inputRule).toContain('background: var(--room-modal-input-bg);');
    expect(inputRule).toContain('color: var(--room-modal-ink);');
  });

  it('keeps ROOM DND explanation copy as prominent as a modal heading', () => {
    const copyRule = styles.match(/\.room-dnd-explanation-modal \.modal-card__copy \{[^}]*\}/s)?.[0] ?? '';

    expect(copyRule).toContain('color: var(--room-modal-ink);');
    expect(copyRule).toContain('font-size: clamp(1.35rem, 2vw, 1.8rem);');
    expect(copyRule).toContain('line-height: 1.2;');
  });

  it('centers ROOM service tile content around only the icon and title', () => {
    const roomTileRule = styles.match(/\.app-frame--room \.service-tile \{[^}]*\}/s)?.[0] ?? '';

    expect(roomTileRule).toContain('align-items: center;');
    expect(roomTileRule).toContain('flex-direction: column;');
    expect(roomTileRule).toContain('justify-content: center;');
    expect(roomTileRule).toContain('text-align: center;');
  });

  it('removes pointer tap chrome while preserving a keyboard-only ROOM focus ring', () => {
    const roomTileRule = styles.match(/\.app-frame--room \.service-tile \{[^}]*\}/s)?.[0] ?? '';
    const pointerFocusRule = styles.match(/\.app-frame--room \.service-tile:focus:not\(:focus-visible\) \{[^}]*\}/s)?.[0] ?? '';
    const keyboardFocusRule = styles.match(/\.app-frame--room \.service-tile:focus-visible \{[^}]*\}/s)?.[0] ?? '';

    expect(roomTileRule).toContain('-webkit-tap-highlight-color: transparent;');
    expect(pointerFocusRule).toContain('outline: none;');
    expect(keyboardFocusRule).toContain('outline: 3px solid var(--room-amber);');
  });

  it('makes service icons transparent while retaining dialog icon backgrounds', () => {
    expect(styles).toMatch(/\.service-tile__icon \{[^}]*background: transparent;[^}]*border: 0;[^}]*border-radius: 0;[^}]*box-shadow: none;[^}]*padding: 0;[^}]*\}/s);
    expect(styles).toMatch(/\.service-tile__icon svg \{[^}]*display: block;[^}]*\}/s);
    expect(styles).toMatch(/\.dialog__icon \{[^}]*background: var\(--amber\);[^}]*\}/s);
    const serviceIconRule = styles.match(/\.service-tile__icon \{[^}]*\}/s)?.[0] ?? '';
    expect(serviceIconRule).not.toContain('var(--amber)');
  });

  it('anchors the ROOM language menu inside the far edge of the viewport', () => {
    expect(styles).toMatch(/\.app-frame--room \.language-selector \.touch-select__menu \{[^}]*left: auto;[^}]*right: 0;/s);
  });

  it('keeps the ROOM language selector as the far-right navbar action', () => {
    const roomLanguageRule = styles.match(/\.app-frame--room \.topbar__actions \.language-selector \{[^}]*\}/s)?.[0] ?? '';
    expect(roomLanguageRule).toContain('margin-left: auto;');
  });

  it('keeps the ROOM connection label visible, enlarged, and spaced at kiosk size', () => {
    const roomActionsRule = styles.match(/\.app-frame--room \.topbar__actions \{[^}]*\}/s)?.[0] ?? '';
    const roomBadgeRule = styles.match(/\.app-frame--room \.topbar__actions \.connection-badge \{[^}]*\}/s)?.[0] ?? '';
    const roomDotRule = styles.match(/\.app-frame--room \.topbar__actions \.connection-badge__dot \{[^}]*\}/s)?.[0] ?? '';
    const squareKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const squareKioskStyles = styles.slice(squareKioskStart, reducedMotionStart);

    expect(styles).not.toMatch(/\.app-frame--room \.connection-badge__label \{[^}]*clip:/s);
    expect(styles).toMatch(/\.app-frame--room \.connection-badge__label \{[^}]*display: inline;/s);
    expect(roomActionsRule).toContain('gap: 14px;');
    expect(roomActionsRule).toContain('padding-left: 12px;');
    expect(roomBadgeRule).toContain('font-size: 0.74rem;');
    expect(roomBadgeRule).toContain('gap: 8px;');
    expect(roomDotRule).toContain('height: 9px;');
    expect(roomDotRule).toContain('width: 9px;');
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.topbar__actions \.connection-badge \{[^}]*font-size: 0\.72rem;/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.topbar__actions \.connection-badge__dot \{[^}]*height: 8px;[^}]*width: 8px;/s);
  });

  it('uses floating non-interactive service page hints that blink only when motion is allowed', () => {
    const railRule = styles.match(/\.service-page-rail \{[^}]*\}/s)?.[0] ?? '';
    const hintRule = styles.match(/\.service-page-hint \{[^}]*\}/s)?.[0] ?? '';
    const previousHintRule = styles.match(/\.service-page-hint--previous \{[^}]*\}/s)?.[0] ?? '';
    const nextHintRule = styles.match(/\.service-page-hint--next \{[^}]*\}/s)?.[0] ?? '';
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const reducedMotionStyles = styles.slice(reducedMotionStart);

    expect(railRule).toContain('position: relative;');
    expect(hintRule).toContain('animation:');
    expect(hintRule).toContain('background: transparent;');
    expect(hintRule).toContain('border: 0;');
    expect(hintRule).toContain('border-radius: 0;');
    expect(hintRule).toContain('height: 72px;');
    expect(hintRule).toContain('width: 24px;');
    expect(hintRule).toContain('pointer-events: none;');
    expect(hintRule).toContain('position: absolute;');
    expect(previousHintRule).toContain('left: 0;');
    expect(previousHintRule).toContain('transform: translate(-50%, -50%);');
    expect(nextHintRule).toContain('right: 0;');
    expect(nextHintRule).toContain('transform: translate(50%, -50%);');
    expect(styles).toMatch(/\.service-page-hint svg \{[^}]*display: block;/s);
    expect(styles).toMatch(/@keyframes service-page-hint-blink\b/);
    expect(reducedMotionStyles).toMatch(/\.service-page-hint[^}]*animation:\s*none(?:\s*!important)?;/s);
  });

  it('styles free ROOM DND green, enabled ROOM DND red, and keeps it larger than a compact control', () => {
    const freeDndRule = styles.match(/\.room-dnd-button \{[^}]*\}/s)?.[0] ?? '';
    const activeDndRule = styles.match(/\.room-dnd-button--active \{[^}]*\}/s)?.[0] ?? '';
    const iconRule = styles.match(/\.room-dnd-button__icon \{[^}]*\}/s)?.[0] ?? '';
    const labelRule = styles.match(/\.room-dnd-button__label \{[^}]*\}/s)?.[0] ?? '';

    expect(freeDndRule).toContain('height: 56px;');
    expect(freeDndRule).toContain('min-height: 56px;');
    expect(freeDndRule).toContain('font-size: 0.82rem;');
    expect(freeDndRule).toContain('gap: 10px;');
    expect(freeDndRule).toContain('white-space: nowrap;');
    expect(freeDndRule).toContain('background: var(--room-dnd-off-bg);');
    expect(freeDndRule).toContain('color: var(--room-dnd-off);');
    expect(activeDndRule).toContain('background: var(--room-dnd-on-bg);');
    expect(activeDndRule).toContain('color: var(--room-dnd-on);');
     expect(iconRule).toContain('font-size: 1.45rem;');
     expect(iconRule).toContain('height: 26px;');
     expect(iconRule).toContain('width: 26px;');
     expect(labelRule).toContain('font-size: 0.95rem;');
    expect(labelRule).toContain('white-space: nowrap;');
    expect(styles).toMatch(/\.room-dnd-indicator, \.room-dnd-status \{[^}]*color: #a94d3a;/s);
  });

  it('compacts only square ROOM kiosk viewports while preserving readable service tiles', () => {
    const squareKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const squareKioskStyles = styles.slice(squareKioskStart, reducedMotionStart);

    expect(squareKioskStart).toBeGreaterThanOrEqual(0);
    expect(reducedMotionStart).toBeGreaterThan(squareKioskStart);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.topbar \{/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.topbar__identity \{/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.topbar__actions \{/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.service-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/s);
     expect(squareKioskStyles).toMatch(/\.app-frame--room \.room-area-grid \{[^}]*display: flex;[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/s);
     expect(squareKioskStyles).toMatch(/\.app-frame--room \.room-area-page \{[^}]*display: grid;[^}]*flex: 0 0 100%;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.room-area-card \{[^}]*min-width: 0;/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.service-tile \{/s);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.service-tile__body \{/s);
    const squareTitleRule = squareKioskStyles.match(/\.app-frame--room \.service-tile__body strong \{[^}]*\}/s)?.[0] ?? '';
    const squareTitleFontSize = Number.parseFloat(squareTitleRule.match(/font-size:\s*([0-9.]+)rem/)?.[1] ?? '0');
    expect(squareTitleFontSize).toBeGreaterThanOrEqual(1.1);
    expect(squareKioskStyles).toMatch(/\.app-frame--room \.service-page-hint \{[^}]*display:\s*(?:block|flex|inline-flex);/s);
    expect(squareKioskStyles).not.toMatch(/\.app-frame--admin/);
    expect(squareKioskStyles).not.toMatch(/\.service-pages \{[^}]*overflow-y: auto;/s);
  });

  it('snaps the square ROOM area rail to complete 2x2 groups', () => {
    const squareKioskStart = styles.indexOf('@media (max-width: 520px) and (max-height: 520px)');
    const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const squareKioskStyles = styles.slice(squareKioskStart, reducedMotionStart);
    const areaGridRule = squareKioskStyles.match(/\.app-frame--room \.room-area-grid \{[^}]*\}/s)?.[0] ?? '';
    const areaPageRule = squareKioskStyles.match(/\.app-frame--room \.room-area-page \{[^}]*\}/s)?.[0] ?? '';
    const areaPageBaseRule = styles.match(/^\.room-area-page \{[^}]*\}/m)?.[0] ?? '';

    expect(areaPageBaseRule).toContain('display: contents;');
    expect(areaGridRule).toContain('display: flex;');
    expect(areaGridRule).toContain('flex-wrap: nowrap;');
    expect(areaGridRule).toContain('overflow-x: auto;');
    expect(areaGridRule).toContain('scroll-snap-type: x mandatory;');
    expect(areaGridRule).not.toContain('grid-auto-columns:');
    expect(areaGridRule).not.toContain('grid-auto-flow:');
    expect(areaGridRule).not.toContain('grid-template-rows:');
    expect(areaPageRule).toContain('display: grid;');
    expect(areaPageRule).toContain('flex: 0 0 100%;');
    expect(areaPageRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(areaPageRule).toContain('grid-template-rows: repeat(2, minmax(0, 1fr));');
    expect(areaPageRule).toContain('scroll-snap-align: start;');
    expect(areaPageRule).toContain('scroll-snap-stop: always;');
    expect(squareKioskStyles).not.toMatch(/\.app-frame--room \.room-area-card:nth-child\(4n \+ 1\)/);
  });
});
