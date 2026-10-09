// ide-byebye-ignore — stands in for a component library: nothing in this file is stamped.
import { createPortal } from 'react-dom';

// Like most library dialogs, the mask, box and close button are rendered into document.body and drop unknown props
// (including the `data-insp-path` the caller's JSX carries). Only the children come from stamped user code.
export function LibDialog({ title, onClose, children }) {
  return createPortal(
    <div className="lib-mask" onClick={onClose}>
      <div className="lib-box" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="lib-head">
          <span>{title}</span>
          <button className="lib-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="lib-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// A presentational library component that also drops unknown props.
export function LibBadge({ children }) {
  return <span className="lib-badge">{children}</span>;
}
