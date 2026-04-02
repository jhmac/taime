# MAinager — Shopify App Reviewer Guide

This document provides everything a Shopify App Store reviewer needs to test MAinager's core functionality end-to-end.

---

## Demo Credentials

| Field | Value |
|-------|-------|
| **App URL** | `https://<your-deployed-domain>` *(replace before submission)* |
| **Demo email** | `reviewer@mainager-demo.app` |
| **Demo password** | `ShopifyReview2026!` |
| **Demo Shopify store** | `mainager-demo.myshopify.com` |
| **Shopify store password** | *(development store — no password required)* |

> **Note:** The demo account is pre-configured with sample data including team members, schedules, and 12 months of synthetic Shopify order history so you can see the full experience without needing to set anything up.

---

## Step-by-Step Review Flow

### Step 1 — Install the App

1. From the Shopify Partners Dashboard, click **Test on development store** and select `mainager-demo.myshopify.com`.
2. Review the requested permissions:
   - `read_orders` — used to pull sales history for staffing recommendations
   - `read_products` — used to display product context in reporting
3. Click **Install app**. You will be redirected to the MAinager onboarding screen.

---

### Step 2 — Complete Onboarding

After install, the post-install onboarding screen confirms:

- Your Shopify store is connected.
- A walkthrough of three setup steps (store connected → add team members → set store hours).

Click **Go to Dashboard** or **Skip setup** to proceed.

---

### Step 3 — Explore the Dashboard

Once inside the app:

1. The **Home** screen shows today's schedule, any pending staffing alerts, and an AI recommendation panel that references your Shopify sales data.
2. Navigate to **Analytics** (admin sidebar) to see daily and weekly sales trends pulled from the connected Shopify store.
3. Check the **Shopify Insights** tab within Analytics to confirm live data is being displayed.

---

### Step 4 — View the Schedule

1. Navigate to **Schedules**.
2. Review the current week's schedule. The scheduler shows recommended coverage levels based on historical Shopify order volume for each day.
3. Tap any shift block to view or edit shift details.

---

### Step 5 — Test Team Management

1. Navigate to **Team**.
2. The demo account includes 3–5 pre-configured team members.
3. Click any team member to view their profile, role, pay rate, and schedule history.

---

### Step 6 — Verify Shopify Connection Status

1. Navigate to **Admin Settings** (gear icon, bottom of sidebar).
2. Select the **Shopify** tab.
3. Confirm the demo store (`mainager-demo.myshopify.com`) is listed as **Connected** with a green status indicator.
4. The last sync timestamp will show when order data was last fetched.

---

### Step 7 — Test App Uninstall (optional)

To verify the `app/uninstalled` webhook:

1. From the Shopify Admin of the development store, navigate to **Apps** and uninstall MAinager.
2. Return to the MAinager Admin Settings > Shopify tab (log in separately if needed).
3. The store should now appear as **Disconnected** — confirming that the webhook correctly deactivated the shop record and cleared the access token.

---

### Step 8 — Test Support & Legal Pages

All three pages below are publicly accessible — no login is required.

1. Open `/support` directly (no authentication needed). Verify the support page loads with contact options including the email address `support@mainager.app`.
2. Open `/privacy` — confirm the Privacy Policy loads.
3. Open `/terms` — confirm the Terms of Service loads.

These routes are served outside the authenticated app shell, matching the same pattern as `/privacy` and `/terms`.

---

## Key Permissions Checklist

| Permission | Why It's Needed |
|------------|-----------------|
| `read_orders` | Sync historical order volume to generate staffing recommendations |
| `read_products` | Display product context in sales reports |

MAinager does **not** request write access, customer data, payment data, or store configuration scopes.

---

## Webhook Registration

MAinager automatically registers the following webhooks on install:

| Topic | Handler |
|-------|---------|
| `orders/create` | Updates daily sales aggregates in real time |
| `app/uninstalled` | Marks shop as inactive and clears the access token |

---

## Contact for Review Questions

Email: `support@mainager.app`  
Support page (in-app): `/support`
