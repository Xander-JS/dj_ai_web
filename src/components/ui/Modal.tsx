import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

// <dialog> nativo: foco atrapado, Escape y backdrop sin lógica extra
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, className }) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={clsx('modal', className)}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <IconButton icon={<X size={18} />} variant="ghost" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
};
