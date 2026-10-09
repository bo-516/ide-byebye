import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LibBadge, LibDialog } from './LibDialog.jsx';

// Portal cases for the inspector. Each one renders outside its owner's DOM, the way dialogs and popovers do.
// ModalHost is mounted in App.jsx, so the dialogs it shows are called from App.jsx, not from this file.

// A tiny external store stands in for an app's modal service: the name of the dialog ModalHost shows, or null.
let activeModal = null;
const modalListeners = new Set();

function openModal(name) {
  activeModal = name;
  modalListeners.forEach((listener) => listener());
}

function subscribeModal(listener) {
  modalListeners.add(listener);
  return () => modalListeners.delete(listener);
}

function readModal() {
  return activeModal;
}

// A hand-written portal dialog with a mask.
function HandDialog({ onClose }) {
  return createPortal(
    <div className="hand-mask" onClick={onClose}>
      <div className="hand-panel" onClick={(event) => event.stopPropagation()}>
        <h3 className="hand-title">Hand-written portal</h3>
        <p className="portal-note">Opened through ModalHost and rendered into document.body.</p>
        <button className="btn btn-primary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

// The wrapper has exactly the panel's box, so picking the panel promotes to the wrapper.
function TightDialog({ onClose }) {
  return createPortal(
    <div className="tight-wrap">
      <div className="tight-panel">
        <h3 className="hand-title">Tight wrapper</h3>
        <p className="portal-note">The outer wrapper is exactly as large as this panel.</p>
        <button className="btn btn-primary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

const MODALS = { hand: HandDialog, tight: TightDialog };

// Shows the registered dialog. Its only root is <Comp />, so the call site passed to ModalHost keeps propagating.
export function ModalHost() {
  const name = useSyncExternalStore(subscribeModal, readModal);
  const Comp = name ? MODALS[name] : null;
  return Comp ? <Comp onClose={() => openModal(null)} /> : null;
}

// A card portaled into the stamped .portal-shell, which has exactly the card's box.
function ShellCard({ container, onClose }) {
  return createPortal(
    <div className="portal-card">
      <strong>Card in a container</strong>
      <p className="portal-note">Portaled into the stamped container right above the buttons.</p>
      <button className="link-btn" type="button" onClick={onClose}>
        Close
      </button>
    </div>,
    container,
  );
}

// The portal holds only a library component, which drops the data attribute.
function ShellBadge({ container }) {
  return createPortal(<LibBadge>Library badge in a container</LibBadge>, container);
}

export function PortalDemo() {
  const [openCase, setOpenCase] = useState(null);
  const [shell, setShell] = useState(null);
  const toggle = (name) => setOpenCase((current) => (current === name ? null : name));
  const close = () => setOpenCase(null);

  return (
    <section className="portal-demo">
      <div className="portal-shell" ref={setShell} />
      <div className="portal-actions">
        <span className="portal-title">Portal cases</span>
        <button className="filter-btn" type="button" onClick={() => openModal('hand')}>
          Dialog
        </button>
        <button className="filter-btn" type="button" onClick={() => openModal('tight')}>
          Tight dialog
        </button>
        <button className="filter-btn" type="button" onClick={() => toggle('card')}>
          Card
        </button>
        <button className="filter-btn" type="button" onClick={() => toggle('badge')}>
          Badge
        </button>
        <button className="filter-btn" type="button" onClick={() => toggle('lib')}>
          Library dialog
        </button>
      </div>
      {openCase === 'card' && shell && <ShellCard container={shell} onClose={close} />}
      {openCase === 'badge' && shell && <ShellBadge container={shell} />}
      {openCase === 'lib' && (
        <LibDialog title="Library dialog" onClose={close}>
          <p className="portal-note">This paragraph is written in PortalDemo.jsx.</p>
        </LibDialog>
      )}
    </section>
  );
}
