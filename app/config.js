// Google OAuth "Web application" client ID for this website (public value, not a secret).
// Created in Google Cloud Console → Clients → Web application, with Authorized JavaScript origin
// https://tlgmailcheck75-byte.github.io
//
// This client lives in project tlg-mail-priority-513317, the same project as the Android
// app. The two used to sit in projects of their own, which would have meant going through
// Google verification twice - two consent screens, two reviews, two waits - for one
// product. Sharing a project means one verification covers gmail.readonly for both and
// drive.appdata for this website.
export const CLIENT_ID = '191596399194-d83u4daief7591sed84g1gil8d7ndigo.apps.googleusercontent.com';
