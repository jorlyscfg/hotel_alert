import { describe, expect, it } from 'vitest';
import { resolveToggleConfirmationCopy, runConfirmation } from '../../apps/web/src/features/admin/AdminScreen';

describe('admin confirmation execution', () => {
  it('builds localized confirmation copy for resource deactivation and reactivation', () => {
    expect(resolveToggleConfirmationCopy('en', 'room', 'Room 101', true)).toEqual({
      title: 'Deactivate room',
      copy: 'Are you sure you want to deactivate Room 101?',
      danger: true
    });
    expect(resolveToggleConfirmationCopy('es', 'administrator', 'supervisor', false)).toEqual({
      title: 'Reactivar administrador',
      copy: '¿Quieres reactivar supervisor?',
      danger: false
    });
    expect(resolveToggleConfirmationCopy('en', 'area', 'Food & Beverage', true)).toEqual({
      title: 'Deactivate area',
      copy: 'Are you sure you want to deactivate Food & Beverage?',
      danger: true
    });
    expect(resolveToggleConfirmationCopy('es', 'service', 'Salida tardía', false)).toEqual({
      title: 'Reactivar servicio',
      copy: '¿Quieres reactivar Salida tardía?',
      danger: false
    });
  });

  it('waits for the confirmed operation and returns its result', async () => {
    let operationFinished = false;

    const resultPromise = runConfirmation(async () => {
      await Promise.resolve();
      operationFinished = true;
      return false;
    });

    expect(operationFinished).toBe(false);
    await expect(resultPromise).resolves.toBe(false);
    expect(operationFinished).toBe(true);
  });

  it('converts an unexpected operation failure into a false confirmation result', async () => {
    await expect(runConfirmation(async () => {
      throw new Error('operation failed');
    })).resolves.toBe(false);
  });
});
