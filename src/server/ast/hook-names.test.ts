import assert from 'node:assert/strict';
import test from 'node:test';
import { findComponentHooks, nameStateSlots } from './hook-names.js';

const TIMER = `import { useEffect, useState } from 'react';

export function FocusTimer() {
  const [left, setLeft] = useState(1500);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return (
    <section onClick={() => setRunning(!running)}>
      <span>{left}</span>
    </section>
  );
}
`;

test('finds the named component around a line and lists its top-level hooks in order', () => {
    const found = findComponentHooks(TIMER, 'FocusTimer.jsx', 13, 'FocusTimer');
    assert.deepEqual(found, {
        name: 'FocusTimer',
        startLine: 3,
        endLine: 16,
        hooks: [
            { hook: 'useState', binding: 'left', line: 4 },
            { hook: 'useState', binding: 'running', line: 5 },
            { hook: 'useEffect', binding: null, line: 6 },
        ],
    });
});

test('skips inline callbacks and other names, and gives up on anonymous components', () => {
    assert.equal(findComponentHooks(TIMER, 'FocusTimer.jsx', 12, 'FocusTimer')?.name, 'FocusTimer');
    assert.equal(findComponentHooks(TIMER, 'FocusTimer.jsx', 13, 'App'), null);
    assert.equal(findComponentHooks(TIMER, 'FocusTimer.jsx', 13, ''), null);
});

test('resolves arrow components, memo/forwardRef wrappers and React.useX calls', () => {
    const code = `const Panel = memo((props) => {
  const [open, setOpen] = React.useState(false);
  const ref = useRef(null);
  return <div ref={ref}>{String(open)}</div>;
});
const Field: FC = () => {
  const { value } = useField();
  return <input value={value} />;
};
`;
    assert.deepEqual(findComponentHooks(code, 'Panel.tsx', 4, 'Panel')?.hooks, [
        { hook: 'useState', binding: 'open', line: 2 },
        { hook: 'useRef', binding: 'ref', line: 3 },
    ]);
    assert.deepEqual(findComponentHooks(code, 'Panel.tsx', 8, 'Field')?.hooks, [{ hook: 'useField', binding: '{…}', line: 7 }]);
});

test('names state slots only when the mapping is certain', () => {
    const plain = [
        { hook: 'useState', binding: 'left', line: 1 },
        { hook: 'useEffect', binding: null, line: 2 },
        { hook: 'useReducer', binding: 'form', line: 3 },
    ];
    assert.deepEqual(Object.fromEntries(nameStateSlots(plain, ['#2', '#0']) ?? []), { '#0': 'left', '#2': 'form' });
    assert.equal(nameStateSlots(plain, ['#0']), null);
    assert.equal(nameStateSlots([...plain, { hook: 'useTasks', binding: 'tasks', line: 4 }], ['#0', '#2']), null);
    assert.equal(nameStateSlots([...plain, { hook: 'useTransition', binding: 'pending', line: 4 }], ['#0', '#2']), null);
    assert.equal(nameStateSlots([{ hook: 'useState', binding: '{…}', line: 1 }], ['#0']), null);
});
