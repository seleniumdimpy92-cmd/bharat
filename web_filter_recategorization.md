# Web Filter Recategorization — Reference Sheet

Site: **https://andamanvoyages.in** · **Bharat Tours and Travels** · **Andaman Voyages**

Use the same prefilled details below to submit a recategorization request to every major web filtering vendor. Most forms need: domain, suggested category, and a short business description.

> ⚠️ Cisco/Umbrella usually flag any domain registered in the last 30 days as **"Newly Seen / Uncategorized"** — that's likely why it's currently blocked. Submitting once gets you reclassified globally; takes 24–72 hours per vendor.

---

## 📋 Universal pre-filled values (copy-paste into every form)

```
Domain / URL          : https://andamanvoyages.in
Alternate URL         : https://www.andamanvoyages.in
Hosting / Backup URL  : https://bharatandaman.netlify.app

Suggested category    : Travel
Secondary category    : Business and Industry  (or "Online Shopping" if Travel not available)

Business name         : Bharat Tours and Travels
Brand / DBA           : Andaman Voyages
Country of operation  : India
Industry              : Travel & Tourism (Travel agency / Tour operator)

Contact name          : <your full name>
Contact email         : info@andamanvoyages.in
Phone                 : +91 88801 95191 / +91 94341 25698
Reason for request    : New / Newly registered domain incorrectly classified

Short description (≤100 chars):
  Andaman Islands holiday packages: Port Blair, Havelock & Neil Island tours.

Long description (≤500 chars):
  Bharat Tours and Travels (Andaman Voyages) is a legitimate travel agency
  based in India offering customizable holiday packages to the Andaman &
  Nicobar Islands — including Port Blair, Havelock Island and Neil Island.
  We provide hotel bookings, ferry transfers, scuba diving, and sightseeing
  tours, with secure online payments via Razorpay. Domain is newly
  registered and is currently incorrectly categorized as
  Uncategorized / Newly Registered Domains. Please reclassify as Travel.
```

---

## 🚦 Vendor submission links (in priority order)

### 1. Cisco Talos  ⭐ (most important — feeds Umbrella, Cisco Secure Web Appliance, etc.)
- **Lookup:**  https://talosintelligence.com/reputation_center/lookup?search=andamanvoyages.in
- **Submit:**  https://talosintelligence.com/reputation_center/sender_ip  (Web → URL Reputation Disputes)
- Direct dispute form:  https://talosintelligence.com/reputation_center/url_disputes
- **Suggested category:** `Travel`
- **Turnaround:** 1–3 business days, e-mail notification on resolution

### 2. Cisco Umbrella / OpenDNS
- **Lookup:**  https://domain.opendns.com/andamanvoyages.in
- **Submit (no login):**  https://community.opendns.com/domaintagging
- **Submit (with Umbrella account):**  https://support.umbrella.com/hc/en-us/requests/new → "Domain Categorization Request"
- **Suggested tag(s):** `Travel`

### 3. Symantec / Broadcom WebPulse (BlueCoat)
- https://sitereview.bluecoat.com/
- Enter URL → bottom "Request Review" → category: `Travel`

### 4. Forcepoint (formerly Websense)
- https://csi.forcepoint.com/  (Tools → URL Categorization)
- Suggest category: `Travel`

### 5. Palo Alto Networks (PAN-DB)
- https://urlfiltering.paloaltonetworks.com/
- Lookup → "Submit a change request" → category: `Travel`

### 6. Fortinet FortiGuard
- https://www.fortiguard.com/webfilter
- Lookup → "Submit a Rating" → category: `Travel`

### 7. Sophos
- https://secure2.sophos.com/en-us/support/contact-support/web-categorization-request.aspx
- Category: `Travel`

### 8. McAfee / Trellix Trusted Source
- https://www.trustedsource.org/
- Lookup → Suggest category: `Travel`

### 9. Zscaler
- https://csi.zscaler.com/
- Lookup → Submit URL → category: `Travel`

### 10. Norton Safe Web
- https://safeweb.norton.com/report/show
- Use this only if Norton flags the site as "unsafe"

### 11. Google Safe Browsing  (only if listed as deceptive/malware)
- https://safebrowsing.google.com/safebrowsing/report_error/

---

## 🧾 What I'd literally type into each "comments / reason" field

> Bharat Tours and Travels (Andaman Voyages) is a newly launched travel
> agency website offering Andaman Islands holiday packages from India.
> The domain `andamanvoyages.in` was registered recently and is
> currently incorrectly categorized as Uncategorized / Newly Registered
> Domains, causing it to be blocked on corporate networks using your
> filtering service. The website serves only legitimate travel-booking
> content (no UGC, no downloads, no adware). Please reclassify it under
> "Travel" (or "Business and Industry" if Travel is unavailable).
>
> Contact: info@andamanvoyages.in · +91 88801 95191
> Backup hosting (same content): https://bharatandaman.netlify.app

---

## ✅ Verifying after submission

After ~24h, recheck status here:

| Vendor | Re-check URL |
|---|---|
| Talos | https://talosintelligence.com/reputation_center/lookup?search=andamanvoyages.in |
| Umbrella | https://domain.opendns.com/andamanvoyages.in |
| BlueCoat | https://sitereview.bluecoat.com/ (look up again) |
| Forcepoint | https://csi.forcepoint.com/ |
| Palo Alto | https://urlfiltering.paloaltonetworks.com/ |
| Fortinet | https://www.fortiguard.com/webfilter |

When the category changes from "Uncategorized" / "Newly Registered Domains" to "Travel" — you're unblocked everywhere using that vendor.

---

## 🛟 Quick workarounds while waiting

- **On your machine:** switch DNS to `1.1.1.1` (Cloudflare) or use phone hotspot.
- **Share with customers stuck behind Cisco:** ask them to use mobile data, or reach you via the alternate `https://bharatandaman.netlify.app` URL until propagation completes.

---

## 📈 Things that speed up approval

1. ✅ HTTPS / valid SSL — already done (Cloudflare auto-issues)
2. ✅ Working email at the domain — already done (`info@andamanvoyages.in`)
3. ⏳ Add **Privacy Policy** + **Terms & Conditions** pages (helps every vendor's automated checks)
4. ⏳ Verify domain on **Google Search Console** — gets you indexed, which web-filter scrapers cross-check
5. ⏳ Create a **Google Business Profile** for "Bharat Tours and Travels / Andaman Voyages" (free) — establishes a real-world business citation
6. ⏳ List on **JustDial**, **TripAdvisor**, **MakeMyTrip Affiliate**, **Sulekha** — even free listings boost trust

---

_Last updated: 22 May 2026_