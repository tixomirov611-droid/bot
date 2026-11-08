# NikCar Fleet Control — SMTP + branded authentication mail

## Status / security
These are **template sources and setup notes**, not a live SMTP connection. Hosting email templates on Render does not configure Supabase Auth; paste each template into **Supabase → Authentication → Email Templates** after connecting an SMTP provider. Never put SMTP credentials, Google App Passwords, Resend keys or Supabase Management API keys in this GitHub repository, frontend JavaScript or Render's static site.

The hosted Supabase project is `cvrbpeuadfxgumvmosni`. Canonical site URL: `https://nikcar-cloud-pilot.onrender.com/`. Register precisely this URL in **Authentication → URL Configuration** (Site URL and Redirect URLs). Keep email confirmation enabled.

## Free starter SMTP with a dedicated Gmail account (does not require buying a domain)

For pilot use only (not recommended as the final fleet-wide transactional email setup):
1. Use a Gmail account dedicated to NikCar, preferably not the owner's personal inbox. Enable Google's **2-Step Verification** and create a **Google App Password** for Supabase in the Google Account security settings.
2. In [Supabase Custom SMTP](https://supabase.com/dashboard/project/cvrbpeuadfxgumvmosni/auth/smtp) enable Custom SMTP and enter:
    - Sender email: the **same Gmail address** as the SMTP user, e.g. an account you control (do not use an invented address).
    - Sender name: `NikCar Fleet Control`
    - Host: `smtp.gmail.com`
    - Port: `465` (TLS; 587 with STARTTLS is another supported option)
    - Username: that Gmail account address
    - Password: the Google **App Password** created for this purpose, *not* the regular Gmail password.
3. Save the settings securely in Supabase dashboard, **not** in the public GitHub repository or the browser. Email confirmation must remain enabled.
4. See notes below to customize and test.

Google App Password availability depends on account security settings; Workspace administrators may restrict it. Gmail has sending and anti-abuse limits, so switch to a transactional provider before opening registration publicly.

## Domain-verified transactional email (preferred for production)

[Brevo](https://www.brevo.com/) has a free tier of up to 300 sends/day, subject to its policies. Verify a domain you control, add DKIM/DMARC DNS records, approve the transactional sender, and generate an **SMTP key** (not a Brevo API key). In Supabase enter:
- Sender email: a sender verified in Brevo, such as `no-reply@YOUR_VERIFIED_DOMAIN`.
- Sender name: `NikCar Fleet Control`.
- Host: `smtp-relay.brevo.com`.
- Port: `587`.
- Username: exact SMTP login shown in Brevo.
- Password: Brevo-generated **SMTP key**.

Do not assume that `nikcar-cloud-pilot.onrender.com` is a domain you control for DKIM. Domain verification requires authority to edit the domain's DNS.

## Customize auth emails

With custom SMTP enabled on a free Supabase project, [Email Templates](https://supabase.com/dashboard/project/cvrbpeuadfxgumvmosni/auth/templates) can be branded.

| Supabase template | File in this folder | Subject |
|---|---|---|
| Confirm signup | `confirmation.html` | `NikCar — підтвердження електронної пошти` |
| Reset password | `recovery.html` | `NikCar — відновлення пароля` |
| Magic link | `magic_link.html` | `NikCar — посилання для входу` |

All templates use the documented Supabase Go-template variable `{{ .ConfirmationURL }}`. Do not replace it with a hardcoded site URL. Keep the button a single-use verification link. Templates contain no tracking pixels and no user-controlled personalized fields.

## Recovery email: NikCar signature and logo (8 November 2026)

The updated **Reset password** template in `recovery.html` has the exact Russian sign-off **«С уважением, команда NikCar»** and a small PNG of the existing NikCar car logo in the footer. The logo is published as `/email-logo.png` on the existing Render Static Site; the visible `NikCar FLEET CONTROL` wordmark is the fallback when an email client blocks remote images.

**Important:** merging/redeploying HTML in GitHub does **not** update the active Supabase Auth template. In [Supabase → Authentication → Email Templates](https://supabase.com/dashboard/project/cvrbpeuadfxgumvmosni/auth/templates), open **Reset password**, set the subject to `NikCar — відновлення пароля`, paste the complete current `nikcar-pilot/email-templates/recovery.html` source in the HTML Body field, and save. The HTML can be opened from `https://nikcar-cloud-pilot.onrender.com/email-templates/recovery.html` after deployment (view source / copy HTML), or directly from GitHub.

Keep the exact **`{{ .ConfirmationURL }}`** template expression; changing it would break the existing tested recovery flow. One end-to-end recovery email after the Auth template is saved is required to confirm the signature and remote image show in the user's email client. Mail clients can block images even when the email is otherwise correct.

## End-to-end test

1. Verify Supabase Site URL and allowlisted redirect.
2. Send ONE signup test to a new email you control; check Supabase Auth logs, your SMTP provider send log, inbox and spam.
3. Open the confirmation link **once** and confirm it returns to the live NikCar domain, not localhost.
4. Send ONE password-reset email to the confirmed account, then verify the new-password form and the ability to log in using the updated password.
5. Test the magic-link flow separately if that option is enabled.
6. If Supabase returns `over_email_send_rate_limit`, do **not** repeatedly click the button; inspect Auth Rate Limits and SMTP send logs. A response indicating email sent does not guarantee inbox delivery.
7. If the `mail.send` log is present but no message arrives, check sender verification, Gmail/Brevo send logs, spam, SPF/DKIM/DMARC and recipient filtering.

Reference: https://supabase.com/docs/guides/auth/auth-smtp
Reference: https://supabase.com/docs/guides/auth/auth-email-templates
Reference: https://supabase.com/kb/troubleshooting/using-google-smtp-with-supabase-custom-smtp-ZZzU4Y
