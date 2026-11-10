import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';

/** RTL `wrapper` that mounts the ConfirmProvider (components using useConfirm throw without it). */
export const ConfirmWrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>;

/** Returns the open confirmation dialog (waits for it). */
export const findConfirmDialog = () => screen.findByRole('alertdialog');

/** Clicks the dialog's primary or cancel button; the second button in DOM order is the confirm action. */
export const answerConfirm = async (accept) => {
  const dialog = await findConfirmDialog();
  const buttons = within(dialog).getAllByRole('button');
  fireEvent.click(accept ? buttons[buttons.length - 1] : buttons[0]);
};
