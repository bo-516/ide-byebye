/**
 * zh/en copy for the floating pick button and touch pick mode.
 *
 * Purpose: `i18n.ts` sits near the 400-line cap, so this feature's strings live here and are spread into its table.
 * Boundary: presentation copy only. The button's resume face reuses `pin.orb.title` from the main table.
 *
 * @type {Record<string, { zh: string, en: string }>}
 */
export const PICK_STRINGS: Record<string, { zh: string; en: string }> = {
    'pick.button.title': { zh: '选取元素', en: 'Pick an element' },
    'pick.button.cancel': { zh: '取消选取', en: 'Cancel picking' },
    'pick.hint': { zh: '点选要修改的元素', en: 'Tap the element you want to change' },
};
