# Privacy Policy

**ShiftView** · Last updated: June 3, 2026

This policy describes what information ShiftView collects, how it is used, and how it is protected.

---

## 1. Who We Are

ShiftView is a shift management tool for retail and hospitality teams. The service is operated by the owner of the ShiftView account you sign in through. References to "we", "us", or "our" in this policy refer to that operator.

---

## 2. Information We Collect

### Account and identity
- Email address (used for authentication via Supabase Auth)
- Display name (your name as it appears on shift cards and in messages)

### Schedule data
- Shift times and dates associated with your employee record
- Clock-in and clock-out records, if punch tracking is enabled

### Messages
- Text messages sent between employees and managers within the app

### Notifications
- Push notification subscription tokens if you grant notification permission in your browser or on your device

### Technical data
- Authentication session tokens (stored in your browser)
- Standard server logs (IP address, user agent, timestamps) retained by the hosting provider

---

## 3. How We Use Your Information

| Purpose | Data used |
|---|---|
| Display the schedule and coverage dashboard | Name, shift times |
| Deliver in-app and push notifications | Name, notification tokens, message content |
| Enable manager-to-employee messaging | Name, message content |
| Authenticate users and enforce access control | Email, session token |
| Audit trail for schedule changes | User ID, timestamps |

We do not sell, rent, or share your personal information with third parties for marketing purposes.

---

## 4. Message Encryption

All messages are encrypted at rest using **AES-256-GCM** before being stored in the database. The server decrypts messages only when delivering them to an authorized recipient (i.e., the sender or the intended receiver) or when generating push notification previews. The database itself never stores plaintext message content.

Messages in transit are protected by TLS (HTTPS).

---

## 5. Data Storage and Security

- Data is stored in a PostgreSQL database managed by [Supabase](https://supabase.com), hosted on AWS infrastructure.
- **Row Level Security (RLS)** is enabled on all tables. Users can only read and write records they are authorized to access.
- Managers are restricted to managing their own team's data.
- Passwords are never stored — authentication is handled entirely by Supabase Auth.

---

## 6. Data Retention

- **Schedule and employee data** is retained for as long as you have an active account.
- **Messages** are retained indefinitely unless deleted by an administrator.
- **Push subscriptions** are automatically removed when a device unsubscribes or the subscription becomes stale.
- On account deletion, your data is removed in accordance with Supabase's cascade delete policies.

---

## 7. Your Rights

Depending on where you are located, you may have the right to:

- **Access** the personal data we hold about you
- **Correct** inaccurate information
- **Request deletion** of your account and associated data
- **Object** to or **restrict** certain types of processing

To exercise any of these rights, contact your account administrator (the manager who invited you) or reach out via the contact information below.

---

## 8. Cookies and Local Storage

ShiftView uses browser storage (cookies and `localStorage`) only to maintain your authentication session. No third-party tracking cookies are used.

---

## 9. Third-Party Services

| Service | Purpose | Privacy policy |
|---|---|---|
| Supabase | Database, authentication, and real-time | [supabase.com/privacy](https://supabase.com/privacy) |
| Vercel | Hosting and edge delivery | [vercel.com/legal/privacy-policy](https://vercel.com/legal/privacy-policy) |
| Web Push (browser API) | Push notifications | Handled by your browser/OS vendor |

---

## 10. Children's Privacy

ShiftView is not intended for use by anyone under the age of 16. We do not knowingly collect personal information from minors.

---

## 11. Changes to This Policy

We may update this policy from time to time. When we do, the "Last updated" date at the top of this page will change. Continued use of the service after changes are posted constitutes acceptance of the updated policy.

---

## 12. Contact

If you have questions about this privacy policy or how your data is handled, please contact the administrator of your ShiftView account.
