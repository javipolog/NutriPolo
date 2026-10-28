import React from 'react';
import { Star, MapPin, AlertTriangle } from 'lucide-react';
import { Input } from '../UI';
import useStore from '../../stores/store';
import { useT } from '../../i18n';
import { getReviewConfig, isValidReviewUrl } from '../../services/reviewRequestService';
import { Toggle, NumberField } from './SettingsFields';

const UrlInput = ({ value, onChange, placeholder, label, t }) => {
  const invalid = !!value.trim() && !isValidReviewUrl(value);
  return (
    <div className="flex-1 min-w-[14rem]">
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="text-sm"
      />
      {invalid && <p className="text-xs text-danger mt-1">{t.review_url_invalid}</p>}
    </div>
  );
};

/**
 * Settings → Recordatorios → Google reviews: when to ask (first visit /
 * follow-ups, hours after the visit), channels, and the review link of each
 * location. The templates are edited in RemindersSection's template editor.
 */
export const ReviewRequestsSection = ({ onGoToSmtp }) => {
  const config = useStore(s => s.config);
  const updateConfig = useStore(s => s.updateConfig);
  const t = useT();
  const rv = getReviewConfig(config);
  const locations = config.locations || [];

  const setReview = (patch) => updateConfig({ reviewRequests: { ...rv, ...patch } });
  const setChannel = (ch, patch) => setReview({ [ch]: { ...rv[ch], ...patch } });
  const setLocation = (id, patch) =>
    setReview({ locations: { ...rv.locations, [id]: { enabled: true, url: '', ...rv.locations[id], ...patch } } });

  const smtpReady = !!config.smtp?.host;

  return (
    <div className="space-y-3 p-4 border border-sage-200 rounded-soft">
      <p className="text-sm font-medium text-sage-800 flex items-center gap-2"><Star size={14} /> {t.review_title}</p>
      <Toggle checked={rv.enabled} onChange={v => setReview({ enabled: v })} label={t.review_enabled} hint={t.review_enabled_hint} />

      {rv.enabled && (
        <>
          <fieldset className="space-y-2">
            <legend className="block text-xs font-medium text-sage-600 mb-1">{t.review_when}</legend>
            <Toggle checked={rv.afterFirstVisit} onChange={v => setReview({ afterFirstVisit: v })} label={t.review_after_first} />
            <Toggle checked={rv.afterFollowUp} onChange={v => setReview({ afterFollowUp: v })} label={t.review_after_followup} />
            <p className="text-xs text-sage-400">{t.review_first_visit_hint}</p>
          </fieldset>

          <div className="flex flex-wrap gap-4">
            <NumberField
              label={t.review_delay}
              value={rv.delayHours}
              onChange={v => setReview({ delayHours: v })}
              suffix={t.review_hours_after}
            />
            <NumberField
              label={t.review_max_age}
              value={rv.maxAgeDays}
              onChange={v => setReview({ maxAgeDays: v })}
              min={1}
              max={60}
              suffix={t.review_days}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="block text-xs font-medium text-sage-600 mb-1">{t.review_channels}</legend>
            <Toggle checked={rv.email.enabled} onChange={v => setChannel('email', { enabled: v })} label="Email" />
            {rv.email.enabled && (
              <div className="pl-6 space-y-2">
                <Toggle
                  checked={rv.email.auto}
                  onChange={v => setChannel('email', { auto: v })}
                  label={t.reminders_email_auto}
                  hint={t.review_email_auto_hint}
                />
                {rv.email.auto && !smtpReady && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
                    <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-warning-dark">
                      {t.reminders_smtp_missing}{' '}
                      {onGoToSmtp && <button onClick={onGoToSmtp} className="underline">{t.reminders_go_to_smtp}</button>}
                    </p>
                  </div>
                )}
              </div>
            )}
            <Toggle checked={rv.whatsapp.enabled} onChange={v => setChannel('whatsapp', { enabled: v })} label="WhatsApp" hint={t.review_whatsapp_hint} />
            <p className="text-xs text-sage-400">{t.review_once_hint}</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="block text-xs font-medium text-sage-600 mb-1">{t.review_links}</legend>
            <p className="text-xs text-sage-500">{t.review_links_hint}</p>
            <label className="block">
              <span className="block text-xs text-sage-600 mb-1">{t.review_default_url}</span>
              <UrlInput
                value={rv.defaultUrl}
                onChange={v => setReview({ defaultUrl: v })}
                placeholder="https://g.page/r/…/review"
                label={t.review_default_url}
                t={t}
              />
            </label>
            {locations.map(loc => {
              const setting = rv.locations[loc.id] || {};
              const enabled = setting.enabled !== false;
              return (
                <div key={loc.id} className="flex flex-wrap items-start gap-3 p-2.5 border border-sage-200 rounded-soft bg-white">
                  <label className="flex items-center gap-2 w-40 shrink-0 pt-2 cursor-pointer">
                    <input type="checkbox" checked={enabled} onChange={e => setLocation(loc.id, { enabled: e.target.checked })} />
                    <MapPin size={13} className="text-wellness-400 shrink-0" />
                    <span className="text-sm text-sage-800 truncate">{loc.name}</span>
                  </label>
                  {enabled ? (
                    <UrlInput
                      value={setting.url || ''}
                      onChange={v => setLocation(loc.id, { url: v })}
                      placeholder={rv.defaultUrl.trim() ? t.review_url_uses_default : 'https://g.page/r/…/review'}
                      label={`${t.review_location_url}: ${loc.name}`}
                      t={t}
                    />
                  ) : (
                    <p className="text-xs text-sage-400 pt-2.5">{t.review_location_off}</p>
                  )}
                </div>
              );
            })}
          </fieldset>
        </>
      )}
    </div>
  );
};

export default ReviewRequestsSection;
