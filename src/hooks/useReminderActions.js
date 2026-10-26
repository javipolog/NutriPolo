import { useCallback } from 'react';
import useStore, { errMsg } from '../stores/store';
import { useToast } from '../components/UI';
import { useT } from '../i18n';
import {
  openWhatsAppReminder, sendEmailReminder, reminderSlot,
} from '../services/reminderService';

/** Human-readable text for a reminder error code. */
export function reminderErrorText(code, t) {
  const c = String(code || '');
  if (c.includes('no_phone')) return t.whatsapp_no_phone;
  if (c.includes('smtp_password')) return t.reminders_err_smtp_password;
  if (c.includes('smtp')) return `${t.reminders_send_failed} (SMTP: ${c})`;
  return `${t.reminders_send_failed}${c ? ` (${c})` : ''}`;
}

/**
 * Send one email reminder and record the outcome on the consultation.
 * Plain function (not a hook) so the background scheduler can use it too.
 * Returns { success, manual, error }.
 */
export async function deliverEmailReminder(consultation, client, overrides = {}) {
  const { config, smtpPassword, setConsultationReminder } = useStore.getState();
  const slot = reminderSlot(consultation);
  const previous = consultation.reminders?.email;
  const attempts = (previous?.slot === slot ? previous.attempts || 0 : 0) + 1;
  setConsultationReminder(consultation.id, 'email', { status: 'sending', at: new Date().toISOString(), slot, attempts });
  let result;
  try {
    result = await sendEmailReminder({ consultation, client, config, smtpPassword, ...overrides });
  } catch (e) {
    result = { success: false, error: errMsg(e) };
  }
  const at = new Date().toISOString();
  setConsultationReminder(consultation.id, 'email', result.success
    ? { status: result.manual ? 'manual' : 'sent', at, slot, attempts }
    : { status: 'error', at, slot, attempts, error: result.error || 'unknown' });
  return result;
}

/** Reminder actions with user feedback (toasts). */
export function useReminderActions() {
  const toast = useToast();
  const t = useT();

  /** Options: `text` replaces the template message; `silent` skips the success toast. */
  const sendWhatsApp = useCallback(async (consultation, client, { text, silent = false } = {}) => {
    const config = useStore.getState().config;
    const result = await openWhatsAppReminder({ consultation, client, config, text });
    if (!result.success) {
      toast.error(reminderErrorText(result.error, t));
      return false;
    }
    useStore.getState().setConsultationReminder(consultation.id, 'whatsapp', {
      status: 'opened', at: new Date().toISOString(), slot: reminderSlot(consultation),
    });
    if (!silent) toast.success(t.whatsapp_reminder_sent);
    return true;
  }, [toast, t]);

  const sendEmail = useCallback(async (consultation, client, overrides) => {
    if (!client?.email) {
      toast.error(t.reminders_state_no_contact_email);
      return false;
    }
    const result = await deliverEmailReminder(consultation, client, overrides);
    if (result.success) toast.success(result.manual ? t.reminders_email_opened : t.reminders_email_sent);
    else toast.error(reminderErrorText(result.error, t));
    return result.success;
  }, [toast, t]);

  return { sendWhatsApp, sendEmail };
}
