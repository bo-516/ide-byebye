/**
 * zh/en copy for the component-state tool (attach current state, watch state changes).
 *
 * Purpose: `i18n.ts` sits near the 400-line cap, so this feature's strings live here and are spread into its table.
 * Boundary: presentation copy only; the prompt text for state is built on the server in English.
 *
 * @type {Record<string, { zh: string, en: string }>}
 */
export const STATE_STRINGS: Record<string, { zh: string; en: string }> = {
    'state.button.title': { zh: '组件状态', en: 'Component state' },
    'state.menu.caption': { zh: '{name} 的状态', en: 'State of {name}' },
    'state.anonymous': { zh: '匿名组件', en: 'Anonymous component' },
    'state.attach': { zh: '附带当前状态', en: 'Attach current state' },
    'state.watch.start': { zh: '开始监听变化', en: 'Watch state changes' },
    'state.indicator': { zh: '监听 {name} · {count} 次变化 · {time}', en: 'Watching {name} · {count} changes · {time}' },
    'state.stop': { zh: '停止', en: 'Stop' },
    'state.chip.snapshot': { zh: '{name} 当前状态', en: '{name} state' },
    'state.chip.watch': { zh: '{name} 状态变化 · {count} 次 · {time}', en: '{name} changes · {count} · {time}' },
    'state.remove.aria': { zh: '移除组件状态', en: 'Remove component state' },
    'state.error.unmounted': { zh: '组件已卸载，读不到它的状态', en: 'The component has unmounted, so its state cannot be read' },
};
