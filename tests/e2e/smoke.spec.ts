import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('serves the health endpoint and initial station setup screen', async ({ page, request }) => {
  const health = await request.get('/api/v1/system/health');
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ data: { status: 'ready', database: 'ready', migrations: 'ready' } });

  await page.goto('/');
  await expect(page).toHaveTitle('Hotel Local App');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('invalid-user');
  await page.getByLabel('Contraseña', { exact: true }).fill('invalid-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('#admin-login-error')).toBeVisible();
  await expect(page.locator('form.auth-form')).toHaveAttribute('aria-describedby', 'admin-login-error');
  await expect(page.getByLabel('Usuario')).toHaveAttribute('aria-describedby', 'admin-login-error');
  await expect(page.getByLabel('Usuario')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('aria-describedby', 'admin-login-error');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});

test('keeps the Admin locale in Spanish without a language selector', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-horse-battery-staple');
  const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/admin/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBe(true);
  const loginBody = await loginResponse.json() as { data: { csrfToken: string } };
  await expect(page.locator('.topbar--admin')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigation = page.locator('[data-admin-navigation="mobile"]');
  const desktopNavigation = page.locator('[data-admin-navigation="desktop"]');
  await expect(mobileNavigation).toBeHidden();
  await expect(desktopNavigation).toBeVisible();
  await expect(desktopNavigation.getByRole('button')).toHaveCount(4);
  await expect(page.locator('.admin-sidebar')).toBeVisible();
  await expect(page.locator('.admin-sidebar').locator('[data-admin-navigation="desktop"]')).toBeVisible();

  await desktopNavigation.getByRole('button', { name: /Cola en vivo/ }).click();
  await expect(page.locator('.queue-filter-grid')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(desktopNavigation).toBeVisible();
  await expect(desktopNavigation.getByRole('button')).toHaveCount(4);
  await expect(mobileNavigation).toBeHidden();
  await expect(page.locator('.admin-sidebar')).toBeVisible();
  await desktopNavigation.getByRole('button', { name: 'Resumen', exact: true }).click();

  const suffix = randomUUID().slice(0, 8);
  const setupResult = await page.evaluate(async ({ csrfToken, suffix }) => {
    const mutationHeaders = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    };
    const roomResponse = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': `retire-room-${suffix}` },
      body: JSON.stringify({ code: `retire-room-${suffix}`, displayName: `Retire room ${suffix}` })
    });
    const roomBody = await roomResponse.json() as { data?: { id: string } };
    if (roomBody.data?.id === undefined) return { roomStatus: roomResponse.status, bootstrapStatus: 0 };

    const bootstrapResponse = await fetch('/api/v1/devices/bootstrap', {
      method: 'POST',
      headers: { ...mutationHeaders, 'Idempotency-Key': `retire-device-${suffix}` },
      body: JSON.stringify({
        installationId: `retire-install-${suffix}`,
        displayName: `Obsolete station ${suffix}`,
        assignmentMode: 'ROOM',
        roomId: roomBody.data.id
      })
    });
    return { roomStatus: roomResponse.status, bootstrapStatus: bootstrapResponse.status };
  }, { csrfToken: loginBody.data.csrfToken, suffix });
  expect(setupResult).toEqual({ roomStatus: 201, bootstrapStatus: 201 });
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.locator('[data-admin-setup-tab="devices"]').click();
  const deviceRow = page.locator('.device-row').filter({ hasText: `Obsolete station ${suffix}` });
  await expect(deviceRow).toBeVisible();
  await deviceRow.getByRole('button', { name: 'Retirar', exact: true }).click();
  await expect(page.getByText('¿Quieres retirar este dispositivo?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar cambio', exact: true }).click();
  await expect(deviceRow).toHaveCount(0);
  await expect(page.getByText('Dispositivo retirado.')).toBeVisible();

  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await expect(page.locator('.topbar--admin .language-selector')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Solicitudes que necesitan avance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good morning, operations.' })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.topbar--admin')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solicitudes que necesitan avance' })).toBeVisible();
  await expect(page.getByLabel('Usuario')).toHaveCount(0);
});

test('preserves an unsaved hotel name when switching System Configuration carousel options', async ({ page }) => {
  const settingsMutationRequests: string[] = [];
  page.on('request', (request) => {
    const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    if (mutatingMethods.has(request.method()) && new URL(request.url()).pathname === '/api/v1/settings') settingsMutationRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.topbar--admin')).toBeVisible();
  await expect(page.locator('.connection-badge--online')).toBeVisible();

  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('tab', { name: 'Configuración del sistema', exact: true }).click();

  const hotelNameInput = page.locator('#setting-hotelName');
  const unsavedHotelName = `Unsaved Hotel ${randomUUID()}`;
  await expect(hotelNameInput).toBeVisible();
  await hotelNameInput.fill(unsavedHotelName);

  await page.getByRole('button', { name: 'Formato del reloj', exact: true }).click();
  await expect(page.locator('[data-admin-settings-option-panel="clock-format"]')).toBeVisible();
  await page.getByRole('button', { name: 'Política de ejecución', exact: true }).click();
  await expect(page.locator('[data-admin-settings-option-panel="runtime-policy"]')).toBeVisible();
  await page.getByRole('button', { name: 'Identidad de la estación', exact: true }).click();
  await expect(hotelNameInput).toHaveValue(unsavedHotelName);
  expect(settingsMutationRequests).toHaveLength(0);
});

test('opens Information settings in a modal and closes after a successful save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.topbar--admin')).toBeVisible();

  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('tab', { name: 'Información', exact: true }).click();

  const panel = page.locator('[data-admin-information-panel="true"]');
  const actions = panel.locator('[data-admin-information-actions="true"]');
  const count = panel.locator('[data-admin-information-count="true"]');
  const upload = panel.locator('[data-admin-information-upload="true"]');
  const settings = panel.locator('[data-admin-information-settings="true"]');
  await expect(panel).toBeVisible();
  await expect(upload).toHaveAttribute('aria-label', 'Cargar imagen');
  await expect(settings).toHaveAttribute('aria-label', 'Configurar información');
  const actionOrder = await actions.evaluate((element) => {
    const children = [...element.children];
    return {
      upload: children.indexOf(element.querySelector('[data-admin-information-upload]')),
      settings: children.indexOf(element.querySelector('[data-admin-information-settings]')),
      count: children.indexOf(element.querySelector('[data-admin-information-count]'))
    };
  });
  expect(actionOrder.upload).toBeGreaterThanOrEqual(0);
  expect(actionOrder.settings).toBeGreaterThan(actionOrder.upload);
  expect(actionOrder.count).toBeGreaterThan(actionOrder.settings);
  await expect(count).toBeVisible();

  await settings.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Mostrar información después de inactividad (segundos)')).toBeVisible();
  await expect(dialog.getByLabel('Tiempo por imagen informativa (segundos)')).toBeVisible();

  const saveResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  expect((await saveResponsePromise).ok()).toBe(true);
  await expect(dialog).toBeHidden();
});

test('keeps the InformationPanel variant upload modal responsive at narrow viewports', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.topbar--admin')).toBeVisible();

  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('tab', { name: 'Información', exact: true }).click();

  const panel = page.locator('[data-admin-information-panel="true"]');
  await panel.locator('[data-admin-information-upload="true"]').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cargar imagen', exact: true })).toBeVisible();

  const overflow = await dialog.evaluate((element) => ({
    dialogScrollWidth: element.scrollWidth,
    dialogClientWidth: element.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth
  }));
  expect(overflow.dialogScrollWidth).toBeLessThanOrEqual(overflow.dialogClientWidth);
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth);
});

test('keeps device registration fields readable in the Stations modal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.topbar--admin')).toBeVisible();

  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.locator('[data-admin-setup-tab="devices"]').click();
  await page.locator('[data-admin-resource-add="devices"]').click();

  const dialog = page.getByRole('dialog');
  const formGrid = dialog.locator('.form-grid');
  await expect(dialog).toBeVisible();
  await expect(formGrid).toBeVisible();

  const desktopMetrics = await formGrid.evaluate((element) => {
    const fields = [...element.querySelectorAll<HTMLElement>('.form-field')];
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      fieldWidths: fields.map((field) => field.getBoundingClientRect().width)
    };
  });
  expect(desktopMetrics.columns).toBe(2);
  expect(desktopMetrics.fieldWidths.every((width) => width >= 200)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMetrics = await formGrid.evaluate((element) => {
    const dialogRect = element.closest('[role="dialog"]')?.getBoundingClientRect();
    const fields = [...element.querySelectorAll<HTMLElement>('.form-field')];
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      fieldWidths: fields.map((field) => field.getBoundingClientRect().width),
      dialogRect: dialogRect === undefined ? null : { bottom: dialogRect.bottom, right: dialogRect.right }
    };
  });
  expect(mobileMetrics.columns).toBe(1);
  expect(mobileMetrics.fieldWidths.every((width) => width >= 200)).toBe(true);
  expect(mobileMetrics.dialogRect).not.toBeNull();
  expect(mobileMetrics.dialogRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  expect(mobileMetrics.dialogRect?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(390);
});

test('keeps the ROOM kiosk readable at the PS52 480x480 viewport', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const adminPassword = 'correct-horse-battery-staple';
  const login = await request.post('/api/v1/auth/admin/login', { data: { username: 'admin', password: adminPassword } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json() as { data: { csrfToken: string } };
  const mutationHeaders = { 'X-CSRF-Token': loginBody.data.csrfToken };

  const area = await request.post('/api/v1/areas', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `layout-area-${suffix}` },
    data: { code: `layout-area-${suffix}`, displayName: `Layout area ${suffix}` }
  });
  expect(area.ok()).toBe(true);
  const areaBody = await area.json() as { data: { id: string } };

  const room = await request.post('/api/v1/rooms', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `layout-room-${suffix}` },
    data: { code: `layout-room-${suffix}`, displayName: `Layout room ${suffix}` }
  });
  expect(room.ok()).toBe(true);
  const roomBody = await room.json() as { data: { id: string } };

  for (let index = 1; index <= 10; index += 1) {
    const service = await request.post('/api/v1/services', {
      headers: { ...mutationHeaders, 'Idempotency-Key': `layout-service-${index}-${suffix}` },
      data: {
        code: `layout-service-${index}-${suffix}`,
        displayName: `Room service ${suffix} ${String(index).padStart(2, '0')}`,
        description: 'Request this service from the front desk.',
        areaId: areaBody.data.id
      }
    });
    expect(service.ok()).toBe(true);
  }

  const bootstrap = await request.post('/api/v1/devices/bootstrap', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `layout-device-${suffix}` },
    data: {
      installationId: `layout-install-${suffix}`,
      displayName: `Layout station ${suffix}`,
      assignmentMode: 'ROOM',
      roomId: roomBody.data.id
    }
  });
  expect(bootstrap.ok()).toBe(true);
  const bootstrapBody = await bootstrap.json() as { data: { deviceToken: string } };

  await page.setViewportSize({ width: 480, height: 480 });
  await page.addInitScript((token: string) => {
    localStorage.setItem('hotel-local-device-token', token);
  }, bootstrapBody.data.deviceToken);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Guest services' })).toBeVisible();

  const topbar = page.locator('.topbar');
  const areaGrid = page.locator('.room-area-grid');
  const bottomControls = page.locator('.room-bottom-controls');
  const requestControl = page.locator('.room-request-control');
  const requestButton = page.locator('.room-request-button');
  const dndControl = page.locator('.room-dnd-control');
  const languageSelector = page.locator('.language-selector');
  const adminButton = page.getByRole('button', { name: 'Admin', exact: true });
  const areaCards = page.locator('.room-area-card');
  const areaCard = areaCards.filter({ hasText: `Layout area ${suffix}` });
  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(480 * 0.35);

  await expect(topbar.locator('.room-identity__title')).toHaveCount(0);
  await expect(topbar.locator('.station-clock')).toHaveCount(0);
  await expect(topbar.locator('.room-dnd-control')).toHaveCount(0);
  await expect(topbar.locator('.room-request-button')).toHaveCount(0);
  await expect(topbar.locator('.language-selector')).toHaveCount(1);
  await expect(topbar.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
  await expect(topbar.locator('.connection-badge__dot')).toBeVisible();
  await expect(bottomControls.locator('.room-request-button')).toHaveCount(1);

  const headerOrder = await topbar.evaluate((element) => {
    const nodes = [
      element.querySelector('.room-identity__code'),
      element.querySelector('.connection-badge__dot'),
      element.querySelector('.language-selector')
    ];
    const allNodes = [...element.querySelectorAll('*')];
    return nodes.map((node) => node === null ? -1 : allNodes.indexOf(node));
  });
  expect(headerOrder.every((index) => index >= 0)).toBe(true);
  expect(headerOrder).toEqual([...headerOrder].sort((left, right) => left - right));

  const roomNumberTypography = await topbar.locator('.room-identity__code').evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: Number.parseFloat(style.fontSize), fontWeight: Number.parseInt(style.fontWeight, 10) };
  });
  expect(roomNumberTypography.fontSize).toBeGreaterThanOrEqual(28);
  expect(roomNumberTypography.fontWeight).toBeGreaterThanOrEqual(700);

  await expect(areaGrid).toBeVisible();
  await expect(areaCards).toHaveCount(6);
  await expect(areaCard).toHaveCount(1);
  await expect(areaCard).toContainText(`Layout area ${suffix}`);
  await expect(areaCard).not.toContainText('10 options');
  const areaGridMetrics = await areaGrid.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length
  }));
  expect(areaGridMetrics.columns).toBe(1);
  expect(areaGridMetrics.overflowX).toBe('auto');
  expect(areaGridMetrics.overflowY).toBe('hidden');
  expect(areaGridMetrics.scrollWidth).toBeGreaterThan(areaGridMetrics.clientWidth);
  expect(areaGridMetrics.scrollHeight).toBeGreaterThanOrEqual(areaGridMetrics.clientHeight);
  await expect(page.locator('.room-area-scroll-hint--previous')).toHaveCount(0);
  await expect(page.locator('.room-area-scroll-hint--next')).toBeVisible();
  await areaCard.scrollIntoViewIfNeeded();
  const areaCardBox = await areaCard.boundingBox();
  expect(areaCardBox).not.toBeNull();
  expect(areaCardBox?.height ?? 0).toBeGreaterThanOrEqual(48);

  await areaCard.click();
  const areaModal = page.locator('.room-area-services-modal');
  await expect(areaModal).toBeVisible();
  await expect(areaCard).toHaveAttribute('aria-expanded', 'true');
  const layoutTiles = areaModal.locator('.service-tile').filter({ hasText: `Room service ${suffix}` });
  await expect(layoutTiles).toHaveCount(10);
  const serviceViewport = areaModal.locator('.room-area-services__viewport');
  await expect(serviceViewport).toBeVisible();
  const serviceViewportMetrics = await serviceViewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY
  }));
  expect(serviceViewportMetrics.overflowX).toBe('auto');
  expect(serviceViewportMetrics.overflowY).toBe('hidden');
  expect(serviceViewportMetrics.scrollWidth).toBeGreaterThan(serviceViewportMetrics.clientWidth);
  expect(serviceViewportMetrics.scrollHeight).toBeGreaterThanOrEqual(serviceViewportMetrics.clientHeight);
  const visibleTileCount = await layoutTiles.evaluateAll((elements) => {
    const viewport = elements[0]?.closest('.room-area-services__viewport');
    if (!(viewport instanceof HTMLElement)) return 0;
    const viewportRect = viewport.getBoundingClientRect();
    return elements.filter((element) => {
      const tileRect = element.getBoundingClientRect();
      return tileRect.left < viewportRect.right && tileRect.right > viewportRect.left && tileRect.top < viewportRect.bottom && tileRect.bottom > viewportRect.top;
    }).length;
  });
  expect(visibleTileCount).toBeLessThanOrEqual(4);
  const modalMetrics = await areaModal.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    right: element.getBoundingClientRect().right,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  }));
  expect(modalMetrics.bottom).toBeLessThanOrEqual(modalMetrics.viewportHeight);
  expect(modalMetrics.right).toBeLessThanOrEqual(modalMetrics.viewportWidth);
  expect(modalMetrics.scrollHeight).toBeGreaterThanOrEqual(modalMetrics.clientHeight);

  const serviceTypography = await layoutTiles.first().evaluate((element) => {
    const title = element.querySelector<HTMLElement>('.service-tile__body strong');
    return {
      titleFontSize: Number.parseFloat(getComputedStyle(title ?? element).fontSize)
    };
  });
  expect(serviceTypography.titleFontSize).toBeGreaterThanOrEqual(18);
  const tileMetrics = await layoutTiles.evaluateAll((tiles) => tiles.map((tile) => {
    return {
      titleCount: tile.querySelectorAll('.service-tile__body strong').length,
      iconCount: tile.querySelectorAll('.service-tile__icon').length,
      subtitleCount: tile.querySelectorAll('.service-tile__subtitle').length,
      arrowCount: tile.querySelectorAll('.service-tile__arrow').length
    };
  }));
  expect(tileMetrics).toHaveLength(10);
  expect(tileMetrics.every(({ titleCount, iconCount, subtitleCount, arrowCount }) => titleCount === 1 && iconCount === 1 && subtitleCount === 0 && arrowCount === 0)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(areaModal).toHaveCount(0);
  await expect(areaCard).toHaveAttribute('aria-expanded', 'false');

  const areaGridBox = await areaGrid.boundingBox();
  const contentBox = await page.locator('.device-layout--room').boundingBox();
  const dndBox = await dndControl.boundingBox();
  const requestBox = await requestControl.boundingBox();
  const bottomControlsBox = await bottomControls.boundingBox();
  const languageBox = await languageSelector.boundingBox();
  const adminBox = await adminButton.boundingBox();
  const areaGridBottom = areaGridBox === null ? Number.POSITIVE_INFINITY : areaGridBox.y + areaGridBox.height;
  const contentRight = contentBox === null ? Number.POSITIVE_INFINITY : contentBox.x + contentBox.width;
  expect(areaGridBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(requestBox).not.toBeNull();
  expect(dndBox).not.toBeNull();
  expect(languageBox).not.toBeNull();
  expect(adminBox).not.toBeNull();
  expect(requestBox?.y ?? 0).toBeGreaterThanOrEqual(areaGridBottom - 1);
  expect(dndBox?.y ?? 0).toBeGreaterThanOrEqual(areaGridBottom - 1);
  expect(adminBox?.y ?? 0).toBeGreaterThanOrEqual(areaGridBottom - 1);
  expect((bottomControlsBox?.y ?? 0) + (bottomControlsBox?.height ?? 0)).toBeGreaterThanOrEqual(478);
  expect(languageBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((topbarBox?.y ?? 0) + (topbarBox?.height ?? 0));
  expect((languageBox?.x ?? 0) + (languageBox?.width ?? 0)).toBeGreaterThanOrEqual((topbarBox?.x ?? 0) + (topbarBox?.width ?? 0) - 8);
  expect((adminBox?.x ?? 0) + (adminBox?.width ?? 0)).toBeGreaterThanOrEqual(contentRight - 8);
  expect(dndBox?.x ?? 0).toBeGreaterThanOrEqual((requestBox?.x ?? 0) + (requestBox?.width ?? 0));
  expect((dndBox?.x ?? 0) + (dndBox?.width ?? 0)).toBeLessThanOrEqual(adminBox?.x ?? Number.POSITIVE_INFINITY);
  expect(dndBox?.width ?? 0).toBeGreaterThan(0);

  const headerCenters = await topbar.evaluate((element) => {
    const selectors = ['.brand-lockup', '.room-identity__code', '.topbar__actions'];
    return selectors.map((selector) => {
      const node = element.querySelector<HTMLElement>(selector);
      if (node === null) return null;
      const box = node.getBoundingClientRect();
      return box.y + box.height / 2;
    });
  });
  expect(headerCenters.every((center): center is number => center !== null)).toBe(true);
  const definedHeaderCenters = headerCenters.filter((center): center is number => center !== null);
  expect(Math.max(...definedHeaderCenters) - Math.min(...definedHeaderCenters)).toBeLessThanOrEqual(2);
  const brandBox = await topbar.locator('.brand-lockup').boundingBox();
  expect(brandBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((topbarBox?.x ?? 0) + 1);

  const controlsOrder = await page.locator('.device-layout--room').evaluate((root) => {
    const candidates = [
      root.querySelector('.room-services-section'),
      root.querySelector('.room-request-control'),
      root.querySelector('.room-dnd-control'),
      [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Admin') ?? null
    ];
    const allNodes = [...root.querySelectorAll('*')];
    return candidates.map((node) => node === null ? -1 : allNodes.indexOf(node));
  });
  expect(controlsOrder.every((index) => index >= 0)).toBe(true);
  expect(controlsOrder).toEqual([...controlsOrder].sort((left, right) => left - right));

  await requestButton.click();
  const requestPanel = page.locator('.room-request-status-modal');
  await expect(page.locator('.room-request-status-scrim')).toBeVisible();
  await expect(requestPanel).toBeVisible();
  const requestPanelBox = await requestPanel.boundingBox();
  expect(requestPanelBox).not.toBeNull();
  expect(bottomControlsBox).not.toBeNull();
  expect(requestPanelBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(bottomControlsBox?.y ?? 0);
  expect(requestPanelBox?.x ?? 0).toBeGreaterThanOrEqual((requestBox?.x ?? 0) - 4);
  expect(requestPanelBox?.width ?? 0).toBeGreaterThan(requestBox?.width ?? Number.POSITIVE_INFINITY);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const languageTrigger = languageSelector.getByRole('combobox');
  await languageTrigger.click();
  await expect(page.locator('.touch-select__backdrop')).toBeVisible();
  await expect(languageTrigger).toHaveAttribute('aria-expanded', 'true');
  const areaCardForLanguageBox = await areaCard.boundingBox();
  expect(areaCardForLanguageBox).not.toBeNull();
  if (areaCardForLanguageBox !== null) {
    await page.mouse.click(areaCardForLanguageBox.x + areaCardForLanguageBox.width / 2, areaCardForLanguageBox.y + areaCardForLanguageBox.height / 2);
  }
  await expect(page.locator('.dialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.modal-card')).toHaveCount(0);
  await expect(languageTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(languageSelector.getByRole('listbox')).toHaveCount(0);
  await languageTrigger.click();
  await languageSelector.getByRole('option', { name: 'English' }).click();
  await expect(page.locator('.touch-select__backdrop')).toHaveCount(0);

  await areaCard.click();
  await expect(areaModal).toBeVisible();
  await areaModal.getByRole('button', { name: `Room service ${suffix} 01` }).click();
  const confirmationModal = page.locator('.room-service-confirmation-modal');
  await expect(confirmationModal).toBeVisible();
  await confirmationModal.getByRole('button', { name: 'Not now' }).click();
  await expect(confirmationModal).toHaveCount(0);

  const isGreen = (color: string): boolean => {
    const channels = color.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [red, green, blue] = channels;
    return red !== undefined && green !== undefined && blue !== undefined && green > red && green > blue;
  };
  const isRed = (color: string): boolean => {
    const channels = color.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [red, green, blue] = channels;
    return red !== undefined && green !== undefined && blue !== undefined && red > green && red > blue;
  };
  const freeDndStyle = await dndControl.locator('button').evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color, height: element.getBoundingClientRect().height };
  });
  expect(freeDndStyle.height).toBeGreaterThanOrEqual(56);
  expect(isGreen(freeDndStyle.backgroundColor) || isGreen(freeDndStyle.color)).toBe(true);

  await dndControl.locator('button').click();
  await expect(dndControl.locator('button')).toHaveAttribute('aria-pressed', 'true');
  const enabledDndStyle = await dndControl.locator('button').evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(isRed(enabledDndStyle.backgroundColor) || isRed(enabledDndStyle.color)).toBe(true);
  await expect(page.locator('.device-footer')).toHaveCount(0);
});

test('queues a room request during a network failure and flushes it after recovery', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const areaCode = `housekeeping-${suffix}`;
  const roomCode = `room-${suffix}`;
  const serviceName = `Fresh towels ${suffix}`;
  const installationId = `install-${suffix}`;
  const adminPassword = 'correct-horse-battery-staple';

  const login = await request.post('/api/v1/auth/admin/login', { data: { username: 'admin', password: adminPassword } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json() as { data: { csrfToken: string } };
  const mutationHeaders = { 'X-CSRF-Token': loginBody.data.csrfToken };

  const area = await request.post('/api/v1/areas', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `area-${suffix}` },
    data: { code: areaCode, displayName: `Housekeeping ${suffix}` }
  });
  expect(area.ok()).toBe(true);
  const areaBody = await area.json() as { data: { id: string } };

  const room = await request.post('/api/v1/rooms', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `room-${suffix}` },
    data: { code: roomCode, displayName: `Room ${suffix}` }
  });
  expect(room.ok()).toBe(true);
  const roomBody = await room.json() as { data: { id: string } };

  const service = await request.post('/api/v1/services', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `service-${suffix}` },
    data: { code: `towels-${suffix}`, displayName: serviceName, areaId: areaBody.data.id }
  });
  expect(service.ok()).toBe(true);
  const serviceBody = await service.json() as { data: { id: string } };

  const bootstrap = await request.post('/api/v1/devices/bootstrap', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `device-${suffix}` },
    data: {
      installationId,
      displayName: `Room station ${suffix}`,
      assignmentMode: 'ROOM',
      roomId: roomBody.data.id
    }
  });
  expect(bootstrap.ok()).toBe(true);
  const bootstrapBody = await bootstrap.json() as { data: { deviceToken: string } };

  await page.addInitScript((token: string) => {
    localStorage.setItem('hotel-local-device-token', token);
  }, bootstrapBody.data.deviceToken);

  let requestPostAttempts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/requests')) requestPostAttempts += 1;
  });

  await page.route('**/api/v1/requests', async (route) => {
    if (route.request().method() === 'POST') {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.route('**/socket.io/**', async (route) => {
    await route.abort('failed');
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Guest services' })).toBeVisible();
  await expect(page.locator('.connection-badge--offline')).toBeVisible();
  const roomAreaCard = page.locator('.room-area-card').filter({ hasText: `Housekeeping ${suffix}` });
  await expect(roomAreaCard).toHaveCount(1);
  await roomAreaCard.click();
  const roomAreaModal = page.locator('.room-area-services-modal');
  await expect(roomAreaModal).toBeVisible();
  await roomAreaModal.getByRole('button', { name: new RegExp(serviceName) }).click();
  await page.getByRole('button', { name: 'Send request' }).click();
  const queuedStatus = page.locator('[role="status"].visually-hidden').filter({ hasText: '1 request waiting to send.' });
  await expect(queuedStatus).toContainText('1 request waiting to send.');
  expect(requestPostAttempts).toBe(0);

  await page.unroute('**/api/v1/requests');
  await page.unroute('**/socket.io/**');
  await expect(queuedStatus).toHaveCount(0, { timeout: 15_000 });
  await page.locator('.room-request-button').click();
  await expect(page.locator('#room-request-status-panel .request-list')).toContainText(serviceName);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await roomAreaCard.click();
  await expect(roomAreaModal).toBeVisible();
  await roomAreaModal.getByRole('button', { name: new RegExp(serviceName) }).click();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('.room-service-confirmation-modal')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Request sent' })).toHaveCount(0);

  const requests = await page.evaluate(async (token: string) => {
    const response = await fetch('/api/v1/room/me/requests', { headers: { Authorization: `Bearer ${token}` } });
    return response.json() as Promise<{ data: Array<{ serviceId: string }> }>;
  }, bootstrapBody.data.deviceToken);
  expect(requests.data.filter((item) => item.serviceId === serviceBody.data.id)).toHaveLength(2);
});

test('claims and acknowledges a pending device token rotation after reconnecting', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const areaCode = `rotation-area-${suffix}`;
  const roomCode = `rotation-room-${suffix}`;
  const installationId = `rotation-install-${suffix}`;
  const adminPassword = 'correct-horse-battery-staple';

  const login = await request.post('/api/v1/auth/admin/login', { data: { username: 'admin', password: adminPassword } });
  expect(login.ok()).toBe(true);
  const loginBody = await login.json() as { data: { csrfToken: string } };
  const mutationHeaders = { ...{ 'X-CSRF-Token': loginBody.data.csrfToken } };

  const area = await request.post('/api/v1/areas', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `rotation-area-${suffix}` },
    data: { code: areaCode, displayName: `Rotation area ${suffix}` }
  });
  expect(area.ok()).toBe(true);
  const areaBody = await area.json() as { data: { id: string } };

  const room = await request.post('/api/v1/rooms', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `rotation-room-${suffix}` },
    data: { code: roomCode, displayName: `Rotation room ${suffix}` }
  });
  expect(room.ok()).toBe(true);
  const roomBody = await room.json() as { data: { id: string } };

  const service = await request.post('/api/v1/services', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `rotation-service-${suffix}` },
    data: { code: `rotation-service-${suffix}`, displayName: `Rotation service ${suffix}`, areaId: areaBody.data.id }
  });
  expect(service.ok()).toBe(true);

  const bootstrap = await request.post('/api/v1/devices/bootstrap', {
    headers: { ...mutationHeaders, 'Idempotency-Key': `rotation-device-${suffix}` },
    data: {
      installationId,
      displayName: `Rotation station ${suffix}`,
      assignmentMode: 'ROOM',
      roomId: roomBody.data.id
    }
  });
  expect(bootstrap.ok()).toBe(true);
  const bootstrapBody = await bootstrap.json() as { data: { device: { id: string }; deviceToken: string } };
  const previousToken = bootstrapBody.data.deviceToken;

  await page.addInitScript((token: string) => {
    localStorage.setItem('hotel-local-device-token', token);
  }, previousToken);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Guest services' })).toBeVisible();

  const rotation = await request.post(`/api/v1/devices/${bootstrapBody.data.device.id}/token-rotation`, {
    headers: { ...mutationHeaders, 'Idempotency-Key': `rotation-${suffix}` },
    data: { gracePeriodMinutes: 5, reason: 'Verify automatic device credential rotation' }
  });
  expect(rotation.status()).toBe(202);

  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('hotel-local-device-token')),
    { timeout: 15_000 }
  ).not.toBe(previousToken);

  const replacementToken = await page.evaluate(() => localStorage.getItem('hotel-local-device-token'));
  expect(replacementToken).not.toBeNull();
  const session = await page.evaluate(async (token) => {
    const response = await fetch('/api/v1/device/session', { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() as { data: { pendingTokenRotation: unknown } } };
  }, replacementToken);

  expect(session.status).toBe(200);
  expect(session.body.data.pendingTokenRotation).toBeNull();
});
