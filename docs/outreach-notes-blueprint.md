# The "Anything else you know about this business?" blueprint

Reusable template for the **From Screenshot → notes box** (and the prospect
page's Notes & Activity, which feeds `Re-run Audit`). Fill it in for **any**
business — it is written for the notes parser (`src/services/notesParser.ts`)
so every line lands as a real audit signal, and for the AI prompt
("owner-verified context") so the report, the outreach email and the PDF all
get sharper.

## The template (copy this, replace the `<...>`)

```
Website: <domain.com>
Email: <main email address>
Phone: <main phone number>
Booking: <yes — <system> at <booking-host/url>   OR   no online booking — customers reach us by phone or the website message form>
Address: <street, city, state zip>
Contact form: <yes — contact page has a message form   OR   no contact form>
Social media: <Facebook, Instagram, YouTube — add URLs if known>
Work hours: <Mon–Fri 8 AM–6 PM, Sat 9 AM–1 PM>
Notable: <1–2 lines: years in business, services, anything you verified>
```

Omit any line you don't know — a partial note is fine.

## Why this order & these exact words

| Line | What it triggers |
|---|---|
| `Website:` | Sets the site the audit credits (first non-social URL wins) |
| `Email:` | Contactability +20 pts, becomes the preferred email (and pre-fills the prospect's Contact Email) |
| `Phone:` | Contactability +30 pts — **list the main number first**, only the first match counts |
| `Booking:` | The **only** place allowed to contain booking words. Yes → system name + URL is captured (Booksy/Calendly/…). No → the exact phrase `no online booking` makes the parser record "none" and stops false credits |
| `Address:` | Not scored — but goes to the AI as verified context (email + PDF get specific) |
| `Contact form:` | Must literally contain **contact form / contact us / contact page / contact section** to flip the audit's "Contact Form" chip |
| `Social media:` | Platform names are enough (low-confidence credit); full URLs give high confidence |
| `Work hours:` | AI context — lets the report talk about after-hours calls credibly |
| `Notable:` | Free text for the AI (years, services, specialties) |

## The three rules that matter most

1. **Never write book / booking / appointment / schedule / reservation outside
   the `Booking:` line.** Any of those words anywhere in the note (without a
   booking URL) makes the parser credit a generic "online booking" — a false
   strength in the audit. Say "message form", not "appointment request form".
2. **Always include the `Booking:` line** — even when the answer is no
   (`no online booking — …`). Silence is fine too, but the explicit negation
   also teaches the AI not to assume booking exists.
3. **The email in your note is a fallback only.** For the pipeline's Contact
   Email to fill automatically, also put the address in the dedicated
   **Email (optional)** field — then Create Business & Run Audit.

## Worked example — WITH online booking (verified against the parser)

```
Website: brightsmiledental.com
Email: hello@brightsmiledental.com
Phone: (402) 555-0147
Booking: yes — Booksy at booksy.com/brightsmile
Address: 8420 Cass St, Omaha, NE 68114
Contact form: yes — contact page has a "send us a message" form
Social media: Facebook (facebook.com/brightsmiledental), Instagram
Work hours: Mon–Fri 8 AM–6 PM, Sat 9 AM–1 PM
Notable: family and cosmetic dentistry, 12 years in practice
```

Parsed: booking = Booksy + URL · email · phone · contact form ✔ · Facebook (URL, 100) + Instagram

## Worked example — WITHOUT online booking (verified against the parser)

```
Website: quickfixgarage.com
Email: service@quickfixgarage.com
Phone: (402) 555-0188
Booking: no online booking — customers reach us by phone or the website message form
Address: 1120 L St, Omaha, NE 68102
Contact form: yes — contact us section with a message form
Social media: Facebook, YouTube
Work hours: Mon–Sat 8 AM–7 PM
```

Parsed: booking = none (negation respected) · email · phone · contact form ✔ · Facebook + YouTube

## Where the note ends up

`notes` → parser → merged into enrichment (fills gaps, never overwrites the
crawl) → **deterministic audit scores** → **AI report prompt** (as
"OWNER-PROVIDED CONTEXT — treat as ground truth") → outreach email body +
attached PDF narrative.

For an existing prospect: add the note → **Re-run Audit (uses your notes)**.
