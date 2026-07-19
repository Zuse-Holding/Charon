import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://10e3a6ce3896ed02366581d206eb2b63@o4511736570511360.ingest.us.sentry.io/4511736574509056",
  tracesSampleRate: 1.0,
  debug: false,
});
