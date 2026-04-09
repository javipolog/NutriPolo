# Google Calendar Integration Fix - Implementation Plan

## Overview
Three interconnected problems: bulletproof disconnect, multi-calendar with per-calendar sync modes, and sync robustness.

---

## Phase 1: Data Model Changes (src/stores/store.js)

### 1A. New googleCalendar config schema
Replace flat calendarId with calendars array. Remove calendarId: primary. Add calendars: [] array of objects with shape: { id, name, color, syncMode (bidirectional|readonly|disabled), isPrimary }.

### 1B. Consultation schema addition
Each consultation gains sourceCalendarId field. Locally created = primary bidirectional calendar. Pulled from Google = source calendar ID. Critical for readonly enforcement.

### 1C. Store version bump and migration
Bump STORE_VERSION 1 to 2. In migrateStore handle v1->v2: convert old calendarId to calendars array entry. Set sourceCalendarId on existing consultations with googleEventId. Must start checking version param (currently ignored).

### 1D. New store action: clearGoogleCalendarData()
Resets config.googleCalendar to defaults with empty calendars array. Strips googleEventId, lastSyncedAt, googleSummary, sourceCalendarId from ALL consultations. Returns old token values for revocation.

---

## Phase 2: Rust Backend (src-tauri/src/google_calendar.rs + main.rs)

### 2A. Add gcal_revoke_token command
POST to https://oauth2.googleapis.com/revoke with form param token. Non-fatal on failure.

### 2B. Enhance CalendarListEntry
Add background_color, foreground_color, access_role fields. Parse from Google API response.

### 2C. Register in main.rs
Add gcal_revoke_token to generate_handler! macro.

---

## Phase 3: Service Layer (src/services/googleCalendarService.js)

### 3A. Add revokeToken() - IPC wrapper for gcal_revoke_token
### 3B. Token refresh mutex - module-level promise lock to prevent parallel refreshes
### 3C. Rewrite syncAll() - iterate enabled calendars, call syncCalendar per each, aggregate stats, try/catch per calendar
### 3D. New syncCalendar(store, token, calendarConfig) - extracted per-calendar logic with sync mode awareness. Readonly: pull only. Bidirectional: full push+pull. Cross-calendar protection: never push from calendar A to B.
### 3E. Update eventToConsultation() - add sourceCalendarId parameter

---

## Phase 4: SettingsView UI (src/components/SettingsView.jsx)

### 4A. Bulletproof handleDisconnect
Revoke tokens at Google (best-effort), call clearGoogleCalendarData(), clear local state.

### 4B. Multi-calendar config UI
Replace single select with calendar list. Per-calendar three-way toggle. AccessRole hints.

### 4C. Update handleConnect
Build calendars array from Google response. Default primary=bidirectional, others=disabled.

---

## Phase 5: CalendarView (src/components/CalendarView.jsx)

### 5A. Fix auto-sync stale closure (CRITICAL)
Change useEffect deps from [] to [config.googleCalendar?.connected, config.googleCalendar?.autoSync]. Ensures interval cleanup on disconnect.

### 5B. Sync status feedback near sync button

---

## Phase 6: ConsultationModal + ConsultationsView

### 6A. ConsultationModal pushToGCal - use sourceCalendarId, skip for readonly
### 6B. ConsultationsView delete - use sourceCalendarId, skip Google delete for readonly

---

## Phase 7: Robustness
### 7A. Per-event try/catch in sync loops, stats.errors counter
### 7B. Auto-retry on 401 with fresh token

---

## Implementation Order
1. Phase 1 (store) -> 2. Phase 2 (Rust) -> 3. Phase 3 (service) -> 4. Phase 5A (quick fix) -> 5. Phase 4 (settings UI) -> 6. Phase 6 (modal+list) -> 7. Phase 7 (robustness)

## Risks
1. Zustand migrate version param currently ignored
2. Shared events across calendars need deduplication
3. API quota scales with calendar count (cap at 10)
