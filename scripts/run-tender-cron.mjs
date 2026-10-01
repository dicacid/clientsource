const url = process.env.TENDER_SCAN_URL || "https://spa-intelligence.onrender.com/api/tenders/cron";
const secret = process.env.TENDER_CRON_SECRET;

if (!secret) {
  console.error("TENDER_CRON_SECRET is required.");
  process.exit(1);
}

const response = await fetch(url, {
  method: "POST",
  headers: {
    "x-tender-cron-secret": secret,
    Accept: "application/json",
  },
  signal: AbortSignal.timeout(11 * 60 * 1000),
});

const body = await response.text();
if (!response.ok) {
  console.error("Tender cron returned HTTP " + response.status + ": " + body);
  process.exit(1);
}

console.log(body);
