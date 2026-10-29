import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { VisuallyHidden } from './a11y';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Shown under the title; also the dialog's accessible description. */
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  /** Footer actions, right-aligned: [Cancel] [primary]. */
  footer?: ReactNode;
}

/**
 * Modal dialog (Radix): focus trap, focus restore, `Esc` to close, scrim + blur.
 * Nested dialogs are forbidden by the design system — use a sheet or an inline step.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
  footer,
}: DialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="nx-dialog-overlay" />
        <RadixDialog.Content
          className="nx-dialog"
          data-size={size}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            // Consumers open dialogs from external controls, without a Radix Trigger.
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <RadixDialog.Title className="nx-dialog-title">{title}</RadixDialog.Title>
          {description === undefined ? (
            <VisuallyHidden>
              <RadixDialog.Description>{title}</RadixDialog.Description>
            </VisuallyHidden>
          ) : (
            <RadixDialog.Description className="nx-dialog-description">
              {description}
            </RadixDialog.Description>
          )}
          {children}
          {footer ? <div className="nx-dialog-footer">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Close trigger for use inside `footer` (keeps close logic out of the caller). */
export const DialogClose = RadixDialog.Close;
