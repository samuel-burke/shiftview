# ShiftView — Functional Requirements

## Overview

ShiftView is a mobile-first shift scheduling dashboard for retail and hospitality managers. It provides real-time visibility into daily staffing coverage, enables managers to edit schedules, and supports a read-only demo mode for unauthenticated visitors.

---

## User Roles

| Role | Description |
|---|---|
| **Visitor** | Unauthenticated. Sees the landing page; can start a demo session (anonymous sign-in into the Demo organization). |
| **Authenticated User** | Signed in via Supabase Auth. Can view live schedule data. No write access. |
| **Manager** | Signed in and present in the `managers` table. Full read/write access. |

---

## Functional Requirements

### FR-1 Authentication

| ID | Requirement | Actor |
|---|---|---|
| FR-1.1 | The system shall provide a sign-in page accessible at `/login`. | Visitor |
| FR-1.2 | Sign-in shall use email + password via Supabase Auth. | Visitor |
| FR-1.3 | A signed-in user shall see a Sign Out button in the header. | Authenticated User |
| FR-1.4 | Signing out shall redirect the user to `/login`. | Authenticated User |
| FR-1.5 | An unauthenticated request to a protected API endpoint shall return HTTP 401. | System |
| FR-1.6 | A non-manager request to a manager-only endpoint shall return HTTP 403. | System |

---

### FR-2 Schedule Viewing

| ID | Requirement | Actor |
|---|---|---|
| FR-2.1 | The dashboard shall default to displaying today's schedule on load. | All |
| FR-2.2 | The user shall be able to navigate to any past or future date using Previous and Next buttons. | All |
| FR-2.3 | A "Today" button shall return the view to the current date. | All |
| FR-2.4 | The user shall be able to select any date from a calendar date picker. | All |
| FR-2.5 | Scheduled employees shall be displayed as shift cards sorted by start time ascending, then end time ascending. | All |
| FR-2.6 | Employees not scheduled on the selected date shall be listed in an "Off Today" section. | All |
| FR-2.7 | Each shift card shall display the employee's name, initials monogram, shift type, start time, end time, and — on today's view — whether they are currently on shift. | All |
| FR-2.8 | An employee currently on shift shall be marked with a "Here" badge. | All |
| FR-2.9 | The time until the next employee's shift begins shall be displayed when applicable. | All |

---

### FR-3 Coverage Status

| ID | Requirement | Actor |
|---|---|---|
| FR-3.1 | The header shall display a live coverage status: **Optimal**, **Low**, or **Critical**. | All |
| FR-3.2 | Coverage status shall be computed from the minimum staff count at any 30-minute interval during store hours. | System |
| FR-3.3 | **Optimal** coverage requires ≥ 3 staff at all times during store hours. | System |
| FR-3.4 | **Low** coverage applies when the minimum drops to 2 staff. | System |
| FR-3.5 | **Critical** coverage applies when the minimum drops below 2 staff. | System |
| FR-3.6 | Coverage status shall only reflect the current time on today's view; it shall show as closed for other dates. | System |
| FR-3.7 | The header shall display a count of employees currently here, total scheduled, and total off. | All |
| FR-3.8 | A coverage timeline chart shall display staff count across the full operating day. | All |
| FR-3.9 | On today's view, the timeline shall show a vertical indicator at the current time with a pulsing dot at the intersection with the coverage line. | All |

---

### FR-4 Employee Detail

| ID | Requirement | Actor |
|---|---|---|
| FR-4.1 | Tapping a shift card shall open a bottom-sheet drawer showing employee details. | All |
| FR-4.2 | The drawer shall display the employee's name, monogram, shift type, start time, end time, and current status. | All |
| FR-4.3 | Shift type shall be derived from clock-in and clock-out times: **Opener** (clock-in ≤ 7:00 AM), **Closer** (clock-out ≥ 9:00 PM), **Mid** (all others). | System |
| FR-4.4 | Status shall be **Here** if the employee is currently on shift, **Not Yet In / Off** if today but not currently on shift, or **Scheduled** for non-today views. | System |
| FR-4.5 | Tapping an off employee card (Off Today section) shall open the drawer in edit mode for managers to add a shift. | Manager |
| FR-4.6 | The drawer shall close when the user taps the backdrop or the close button. | All |

---

### FR-5 Shift Management (Manager Only)

| ID | Requirement | Actor |
|---|---|---|
| FR-5.1 | A manager shall be able to edit the start and end time of any scheduled shift. | Manager |
| FR-5.2 | A manager shall be able to mark a scheduled employee as off, removing their shift from the schedule. | Manager |
| FR-5.3 | A manager shall be able to add a shift for an employee currently listed as off. | Manager |
| FR-5.4 | Shift edits shall be persisted to the database immediately on save. | System |
| FR-5.5 | The UI shall display a validation error if the start time is not before the end time. | System |
| FR-5.6 | The API shall reject shifts shorter than 1 hour or longer than 16 hours. | System |
| FR-5.7 | The API shall reject invalid date formats or minute values outside 0–1440. | System |
| FR-5.8 | After a successful save or delete, the schedule list shall update without requiring a full page reload. | System |

---

### FR-6 Store Hours

| ID | Requirement | Actor |
|---|---|---|
| FR-6.1 | Store open and close times shall be stored per day-of-week in the database and fetched on app load. | System |
| FR-6.2 | The coverage timeline x-axis shall span exactly from the store's open time to close time for the selected day. | System |
| FR-6.3 | If the store hours API fails, the app shall fall back to default hours (6 AM – 10 PM Mon–Sat, 8 AM – 8 PM Sun). | System |

---

### FR-7 Demo Mode

| ID | Requirement | Actor |
|---|---|---|
| FR-7.1 | Clicking "View Demo" shall sign the visitor in anonymously and grant manager access to a dedicated, seeded Demo organization. | Visitor |
| FR-7.2 | Demo mode shall not require account creation; one click starts a session. | Visitor |
| FR-7.3 | Demo pages shall display a banner indicating demo mode and that sample data resets nightly. | Visitor |
| FR-7.4 | Demo data shall cover a rolling window around today, reset and reseeded nightly via a scheduled job (`/api/cron/demo-reset`). | System |
| FR-7.5 | Demo writes shall behave like production writes within the Demo organization, except for outbound side effects (email, push, auth invites), which shall be suppressed. | System |
| FR-7.6 | Demo data shall be isolated from customer organizations by the same org-scoped RLS policies as any tenant. | System |

---

### FR-8 Data & Sync

| ID | Requirement | Actor |
|---|---|---|
| FR-8.1 | The live clock shall update the current time every 60 seconds without a page reload. | System |
| FR-8.2 | The user shall be able to pull down on mobile to force-refresh employees and schedules. | All |
| FR-8.3 | Skeleton loading states shall be displayed while schedule data is being fetched. | System |

---

## Business Rules

| Rule | Description |
|---|---|
| BR-1 | Employees with no schedule row for a given date are considered **off** for that day. |
| BR-2 | Times are stored as integer minutes since midnight (e.g., 480 = 8:00 AM). |
| BR-3 | A shift must be at least 60 minutes and at most 960 minutes (16 hours). |
| BR-4 | Start minutes must be less than end minutes on the same calendar day (no overnight shifts). |
| BR-5 | Opener classification: clock-in time ≤ 420 minutes (7:00 AM). |
| BR-6 | Closer classification: clock-out time ≥ 1260 minutes (9:00 PM). Opener takes precedence. |
| BR-7 | Optimal coverage threshold: 3 staff. Minimum coverage threshold: 2 staff. |

---

## Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The app shall be optimized for mobile viewports (320 px – 480 px wide). |
| NFR-2 | All API endpoints shall validate input and return structured error responses. |
| NFR-3 | Row Level Security shall be enabled on all live Supabase tables. |
| NFR-4 | The app shall display meaningful loading and error states for all async operations. |
