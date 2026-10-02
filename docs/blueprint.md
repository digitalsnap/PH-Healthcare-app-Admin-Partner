# Product Blueprint: Coverage-First Health Access Platform (Philippines)

**Working name:** TBD

**Positioning:** Know where to go, what you'll pay, and what help you can get, for yourself or the family back home.

**Provider focus (decided):** Diagnostics and pharmacies are the commercial core. Doctors are a full segment (front office only). YAKAP clinics are a free listing and booking channel, not a software product — see 2.1.

**Launch geography (decided):** provinces first, outside Metro Manila. One pilot province, built around a hub city and its surrounding towns, then expansion in regional waves.

**Regions in scope:** CALABARZON (IV-A), Central Luzon (III), Western Visayas (VI), Eastern Visayas (VIII), Zamboanga Peninsula (IX), Northern Mindanao (X), Davao Region (XI), SOCCSKSARGEN (XII) and MIMAROPA (IV-B).

**Platforms:** Provider and admin web surfaces first, then native patient apps (Kotlin for Android, then Swift for iOS), with the public website alongside. The conversational Viber/Messenger and SMS booking bot is the last item in the pipeline.

**Build order (decided):** admin console → doctor and provider dashboards (calendar, scheduler, teleconsult) → patient mobile app. Supply is built before demand: a patient app is worthless with no bookable calendars behind it.

---

## 1. Strategy

Match what patients already get from Zocdoc, NowServing, mWell and ClinicFinderPH, so nobody has a reason to stay with a competitor. Then win with three things none of them are built for:

- **Cost Clarity:** the patient's likely out-of-pocket cost before the visit.
- **Family & OFW Circle:** managing and paying for a relative's care from anywhere.
- **Assistance Case File:** getting government medical assistance without repeat trips.

On the supply side, we own the three segments that sit at the heart of affordable care and that existing platforms underserve: **YAKAP primary-care clinics, diagnostics, and pharmacies.** Together they cover the most common patient journey in the Philippines: consult at a primary-care clinic, get lab tests, pick up medicines. That journey is exactly where coverage (YAKAP, GAMOT, HMO, discounts) makes the biggest difference to cost.

We launch in the provinces, where the problem is sharper and competitors are thinner. Outside Metro Manila, patients often travel far to reach an accredited provider, only to find it closed, out of stock or not covering what they need. Many of their children work abroad and help pay for care from a distance.

---

## 2. Provider focus and go-to-market

### 2.1 Segment strategy

**Commercial core: diagnostics and pharmacies.** These are where no incumbent moat exists, where the coverage story is cleanest (a lab test with HMO and YAKAP applied; a medicine with the GAMOT balance applied), and where businesses already pay to acquire customers. Revenue expectations should rest here.

**Doctors: a full segment, front office only.** Any PRC-licensed doctor practising in the pilot province — any specialty, solo, clinic-based or hospital-affiliated — gets the doctor dashboard: calendar, availability rules across multiple clinics, scheduler, teleconsult room, appointment list, and consult summaries released to the patient's vault. We do **not** build clinical charting, SOAP notes, problem lists, vitals history, billing, receipts or HMO claims.

**YAKAP clinics: a listing and booking channel, not a software product (revised).** The original plan assumed YAKAP clinics were underserved. They are not. PhilHealth runs a Certified Service Provider programme, and roughly 29 vendors are certified under YAKAP 1.1 — including SeriousMD (certified January 2026), mWell HealthSuite (December 2025), BluHealth, DigiHealth and Soltech. What a YAKAP clinic actually needs from software is how it gets paid: PCU liveness checks and empanelment through the Digital YES platform, First Point of Entry documentation, encrypted XML claims submission with one transmittal number per consultation, capitation tracking across benefit tranches, and the GAMOT medicine list. Certification requires EMR functions we have ruled out of scope, so we cannot be that system.

Consequences, applied throughout this document:

- No subscription revenue is modelled from YAKAP clinics. Listing, profile and booking are free.
- Clinics are valued as **patient supply and coverage proof**, not as paying customers.
- If clinics matter commercially later, the move is to **integrate with a certified vendor** (read-only availability, booking push) rather than compete with one. Treat that as a partnership conversation, not a build.

**What this does to the competitive picture.** On provider tooling we are behind on day one and should stop pretending otherwise:

| Competitor | Their strength | Where we still win |
|---|---|---|
| SeriousMD / NowServing | Free EMR for Filipino doctors, YAKAP-certified, patient-side directory and booking | Coverage-first patient flow; family and OFW booking and payment; assistance navigation |
| mWell | Metro Pacific-backed, certified PhilHealth Clinic Management System replacing eKonsulta, around 37% of users from underserved sectors, BangkaHealth boats reaching island barangays | Cost before the visit, not just a consult; pharmacy stock and travel reality; government assistance |
| KonsultaMD, Medgate, Doctor Anywhere, Medifi, HealthNow | Cheap or HMO-free teleconsults (roughly ₱120–₱750; mWell/KonsultaMD around ₱150/month unlimited) | We are not a consult marketplace; teleconsult is a tool for a doctor's own patients |
| SeeYouDoc | Existing LGU and government-hospital integrations (Marikina, Parañaque, Lal-lo, Mendez) | Province-wide coverage and assistance data, not single-LGU deployments |
| ClinicFinderPH | Strong SEO on facilities and assistance guides | Guides that end in a booking, a confirmed stock check and a document checklist |

**The edge to protect.** None of the above answers "what will this cost me before I leave home," none lets a daughter in Dubai book and pay for her mother's care, and none turns Malasakit, PCSO, DSWD and MAIFIP into a document checklist. Those three remain the product. Everything else is parity work that exists so nobody has a reason to stay elsewhere.

**Teleconsult positioning (revised).** With competitors at roughly ₱150/month for unlimited consults, we do not compete on consult price and do not run a consult marketplace. Teleconsult exists so a doctor can see **their own** patients in towns too far to visit, and so a follow-up does not require another bus fare. Price it as a doctor feature, not a patient product, and expect modest revenue from it.

### 2.2 What each segment gets

| Segment | Their problem | What we give them | How they pay |
|---|---|---|---|
| **YAKAP clinics (private)** | Need registered members, first-patient encounters completed, follow-ups kept; long walk-in queues | Free listing with YAKAP badge, "choose this clinic" routing to official registration channels, first-encounter and follow-up booking, queue status, no-show reminders | **Free.** Their certified vendor handles claims and capitation; we do not charge to sit beside it |
| **YAKAP clinics (RHUs, health centers)** | Limited staff and tech; patients arrive without documents | Free verified listing, hours and services, "what to bring" checklist, optional wait-time updates | Free; LGU partnership or MOU later |
| **Diagnostic centers** | Unpredictable walk-in volume, patients arrive unprepared, price questions tie up phone lines | Online booking by branch and slot, published prices with coverage applied, prep instructions (fasting etc.), home-service scheduling, results delivered to the patient's vault | Per completed booking fee or monthly subscription per branch |
| **Pharmacies (GAMOT and non-GAMOT)** | Patients don't know which pharmacy is accredited or in stock; lost refill customers | GAMOT status, stock flags for common medicines, reservations, refill reminders that bring patients back, later delivery | Free listing and GAMOT status; paid reservation, refill and delivery tools |
| **Doctors (all PRC-licensed, any specialty, in the pilot province)** | Manual appointment books, phone-and-text scheduling, no-shows, idle clinic hours, no way to see patients in far towns | Doctor dashboard: profile and clinic affiliations, availability rules across multiple clinics, calendar, appointment list, teleconsult room, no-show reminders, consult summary released to the patient's vault, patient flow from coverage-first search | Free core; paid tier for teleconsult, multi-clinic schedules and analytics |

**Boundaries with PhilHealth systems:**
- YAKAP registration happens through official channels (eGovPH, PhilHealth portal, PhilHealth offices, or the clinic). We guide patients to them and help them choose a clinic; we do not register on their behalf.
- GAMOT e-prescriptions are issued in PhilHealth's own app. We help patients find accredited pharmacies with stock and track their own remaining balance; we do not issue or process GAMOT prescriptions.

### 2.3 Sales motion

- **Diagnostics:** chain-level partnership deals first (one agreement unlocks many branches), then independent labs.
- **Pharmacies:** regional and independent GAMOT-accredited pharmacies first, where footfall matters most; pharmacist association channels for reach.
- **Private YAKAP clinics:** free onboarding, pitched as patient volume and fewer no-shows. Never pitched as a replacement for their certified YAKAP vendor — ask which vendor they use and position beside it.
- **Doctors:** recruit in the pilot province only — teleconsult is not opened to doctors nationwide at this stage, so supply and patients stay in the same area and the field team can meet every doctor in person. Approach through the clinics and hospitals already onboarded, then their referral networks and local medical societies. Lead with patient flow and filling idle clinic hours, never with "better software than SeriousMD."
- **Doctor onboarding requires PRC verification** before a profile goes live or a calendar accepts bookings.
- **RHUs and health centers:** list from public data immediately; pursue MOUs with municipal health offices and the provincial health office for verified updates once there is patient traction to show.
- **Pharmacy chains:** chains have been expanding GAMOT accreditation to their provincial branches, so a chain agreement can cover several towns at once.

---

## 3. Provincial launch

### 3.1 Why provinces first

- **The access gap is bigger.** As of August 2026, PhilHealth reported that only about half of LGUs had an accredited GAMOT provider, and senators raised complaints about patients spending extra on transport to reach one. Knowing where to go before leaving home is worth more in a province than in Metro Manila.
- **Fewer competitors.** Existing health apps and directories are strongest in Metro Manila and major cities.
- **OFW families are concentrated outside NCR.** In PSA's 2024 data, CALABARZON (20.5%), Central Luzon (11.3%) and Western Visayas (9.5%) were the top home regions of OFWs. This is exactly who the Family & OFW Circle is built for.
- **Local businesses are easier to reach.** Independent diagnostics and pharmacies in a provincial hub city are more likely to take a meeting and value new customers than large Metro Manila chains.

### 3.2 How to choose the pilot province

Score each candidate from 1 to 5 on:

| Criterion | What to check |
|---|---|
| OFW household density | PSA province-level Survey on Overseas Filipinos data |
| Coverage gap | Municipalities without a GAMOT pharmacy or with few YAKAP clinics (PhilHealth accredited lists) |
| Hub city strength | A city with enough diagnostics and pharmacies to recruit partners |
| Connectivity | Mobile data coverage in the hub and surrounding towns |
| Field operations | Travel time and cost from your base for onboarding visits |
| Local relationships | Family, friends, business contacts, or a local co-founder who can open doors |
| Language | Whether localization beyond Filipino and English is needed at launch |

**Candidate regions (score provinces within each with the scorecard above):**

| Region | Hub city options | Why it's attractive | Watch-outs |
|---|---|---|---|
| CALABARZON (IV-A) | Batangas City, Lipa, Lucena | Largest OFW-sending region; drivable from Makati for frequent field visits; GAMOT's expanded medicine list has been rolling out in the region | Towns near Metro Manila may already travel there for care |
| Central Luzon (III) | San Fernando (Pampanga), Cabanatuan, Tarlac City | Second-largest OFW-sending region; strong provincial commercial hubs | Proximity to NCR for areas close to Metro Manila |
| Western Visayas (VI) | Iloilo City, Bacolod | Third-largest OFW-sending region; Iloilo City is a medical hub for nearby provinces | Farther for field operations; Hiligaynon localization |
| MIMAROPA (IV-B) | Calapan, Puerto Princesa | Island provinces with real travel barriers, where confirming hours and stock before a boat or long road trip matters most; Oriental Mindoro connects to Batangas by ferry | Historically among the lowest shares of OFWs; weather-dependent sea travel; smaller provider base to recruit from |
| Eastern Visayas (VIII) | Tacloban, Ormoc, Catbalogan | Wide rural areas and island provinces where access gaps are large; Tacloban is the region's referral center | Among the most typhoon-exposed regions; Waray and Cebuano localization |
| Zamboanga Peninsula (IX) | Zamboanga City, Dipolog, Pagadian | PhilHealth launched GAMOT in Zamboanga City in May 2026, so the program is new and awareness is low | Check government security and travel advisories for specific areas; Chavacano and Cebuano localization; referrals may cross into BARMM, where the Ministry of Health–BARMM runs health programs |
| Northern Mindanao (X) | Cagayan de Oro, Iligan, Malaybalay | Cagayan de Oro is a major referral and commercial hub for northern Mindanao; strong base for a Mindanao field team | Cebuano localization; island province (Camiguin) and upland Bukidnon travel |
| Davao Region (XI) | Davao City, Tagum, Digos | Davao City is Mindanao's largest city and medical hub, with many diagnostics and pharmacies to recruit | More competition and larger chains in the city itself; the opportunity is stronger in surrounding provinces |
| SOCCSKSARGEN (XII) | General Santos, Koronadal, Kidapawan | PhilHealth accredited 20 GAMOT pharmacies in South Cotabato in May 2026, giving a ready partner base; provincial government is active on community health access | Hiligaynon and Cebuano localization; referrals may cross into BARMM; check advisories for specific areas |

Verify province-level OFW numbers (PSA Survey on Overseas Filipinos) and current accreditation counts (PhilHealth YAKAP and GAMOT lists) before committing to a province.

**Recommendation:**
- **Pilot:** a CALABARZON province within driving distance of Makati (e.g., Batangas). Frequent in-person onboarding matters more than anything else in the first six months.
- **Strong alternative pilot:** South Cotabato (General Santos or Koronadal hub) or Cagayan de Oro, if you can put a local field lead there from day one.

### 3.3 Regional rollout waves

| Wave | Regions | Logic |
|---|---|---|
| Pilot | One province (see recommendation) | Prove patient demand, provider value and the assisted-booking model |
| Wave 1 | Rest of CALABARZON, Central Luzon, MIMAROPA (starting with Oriental Mindoro) | Reachable from Makati; MIMAROPA tests the island-travel features close to base |
| Wave 2: Mindanao cluster | Northern Mindanao (X), Davao Region (XI), SOCCSKSARGEN (XII), Zamboanga Peninsula (IX) | One Mindanao field hub (e.g., Cagayan de Oro or Davao City) and shared Cebuano localization serve most of the cluster |
| Wave 3: Visayas | Western Visayas (VI), Eastern Visayas (VIII), rest of MIMAROPA (Palawan, Romblon, Marinduque) | Adds Hiligaynon and Waray localization; disaster-mode features proven by then |

Waves are a default order, not a commitment. Move a region earlier if you find a strong local partner or a provincial health office that wants to work with you.

### 3.4 Provincial adaptations

**Geography: hub and spoke**
- Launch in one hub city plus the surrounding towns within roughly one to two hours of travel.
- Aim for every municipality in the pilot area to show at least one verified option for primary care, diagnostics and medicines, even if that option is in the next town.

**"Is the trip worth it?"**
- Cost Clarity adds estimated travel time and fare range (tricycle, jeepney, van, bus) from the patient's barangay to each facility.
- Before a patient travels, show confirmed open hours and, for pharmacies, a same-day stock confirmation or reservation.
- Compare options side by side: "Nearest pharmacy: 10 minutes, medicine not confirmed. GAMOT pharmacy in the hub city: 50 minutes, in stock, ₱0 with GAMOT."

**Island and long-distance travel (MIMAROPA, Eastern Visayas, island provinces elsewhere)**
- Travel estimates include boat and ferry legs, with typical schedules and a warning that sea travel can be cancelled in bad weather.
- For islands, highlight what can be done locally before recommending a trip to the mainland or hub city.

**Disaster mode (all regions, critical for typhoon-exposed areas)**
- Facilities and pharmacies can mark themselves open, limited or closed, with a reason, during typhoons, floods and other emergencies.
- A banner shows the latest verified status for the patient's municipality and links to official advisories.
- Refill reminders prompt families to secure maintenance medicines before a forecast storm.

**Languages**
- Filipino and English at launch, with a localization framework from day one.
- Add languages by wave: Cebuano/Bisaya (most of Mindanao and parts of the Visayas), Hiligaynon (Western Visayas, parts of SOCCSKSARGEN), Waray (Eastern Visayas) and Chavacano (Zamboanga).

**Field safety**
- A field operations policy that checks current government security and travel advisories before visits to specific areas.

**Public facilities are central**
- Many YAKAP clinics in provinces are rural health units, so RHU, barangay health station and health center listings must be complete and accurate at launch.
- Map the referral path: RHU → district or provincial hospital → DOH regional hospital with a Malasakit Center → a regional medical hub (e.g., Cagayan de Oro, Davao City, Iloilo City) or Metro Manila specialty hospital when needed.
- Where referrals cross into BARMM, note that health programs there are run by the Ministry of Health–BARMM.

**Assisted and low-data access**
- Transactional SMS is in the MVP: booking and reservation confirmations with a short code, reminders and circle updates all work without the app.
- Conversational booking (a bot that takes a booking over Viber, Messenger or SMS) is the last thing built, after the apps, the web surfaces and the provider tools are stable.
- Assisted booking at partner pharmacy counters and diagnostics front desks; later, through barangay health workers under a municipal health office agreement.
- Lightweight pages and an offline-tolerant web app for weak signals.
- Families (including OFWs) can set up and manage accounts for parents who don't use smartphones, with the patient's consent.

**Payments**
- Pay at the counter is the default.
- GCash and Maya for local payments; international cards for OFW relatives paying remotely.

**Trust and marketing**
- Local ambassadors or a local partner who knows the hub city's providers.
- Facebook community groups, local radio, and pharmacy and clinic counter materials.
- OFW community groups abroad with members from the pilot province.
- Provincial and municipal health programs are often associated with local officials. List them factually and stay politically neutral in all branding and partnerships.

### 3.5 Pilot targets (one province)

| Segment | Target partners | Minimum to launch |
|---|---|---|
| Public facilities (RHUs, health centers, district and provincial hospitals) | All in the pilot area (directory) | Verified hours, services and Malasakit desk status |
| Private YAKAP clinics | 10 | 5 with live booking |
| Doctors (PRC-verified, pilot province) | 25 | 12 with a live calendar, 6 offering teleconsult |
| Diagnostic branches | 10 | 6 with live booking and prices |
| Pharmacies | 30 | 20 with GAMOT status and weekly stock flags |
| Municipal coverage | Every municipality in the pilot area | At least one verified primary care, diagnostics and medicine option within reach, with travel estimate |

---

## 4. Competitor parity: what we adopt and how we improve it

| Feature | Seen at | Our version |
|---|---|---|
| Search by specialty, condition, location | Zocdoc, ClinicFinderPH | Adds a coverage filter: PhilHealth YAKAP, GAMOT, HMO, senior/PWD discount, cash price range |
| "Near me" facility directory incl. RHUs, health centers, gov hospitals | ClinicFinderPH | Every listing shows a "last verified" date and Malasakit desk availability |
| Online booking with real-time slots | Zocdoc, NowServing | Focused on YAKAP clinics and diagnostics; book for yourself or a family member, pay locally or from abroad |
| Queue position / "clinic is open" alerts | NowServing | For YAKAP clinics and diagnostics, extended to public OPDs via reported wait times |
| Verified reviews | Zocdoc | Only after a completed booked visit or reservation; written in Filipino or English |
| E-prescriptions and patient files | NowServing | Family health vault for prescriptions and results the patient uploads or receives; GAMOT balance tracking |
| Lab and diagnostics booking | NowServing (lab partner) | A core product, not a partner add-on: prices, prep instructions, home service, coverage applied |
| Medicine ordering and delivery | NowServing, mWell | GAMOT pharmacy finder with stock flags, reservations, refill reminders; delivery in Phase 3 |
| HMO-aware booking | SeriousMD | Part of the full coverage stack for clinics and diagnostics |
| AI-assisted search | Zocdoc | Understands Taglish symptom descriptions; routes to primary care, diagnostics or emergency care |
| Teleconsultation | NowServing, mWell, KonsultaMD, Medgate, Medifi (roughly ₱120–₱750, or ~₱150/month unlimited) | Not a consult marketplace and not priced against them. A doctor's own patients, in towns too far to visit, with coverage and cost shown before booking |
| Provider scheduling tools | SeriousMD | Calendar, recurring availability rules and a scheduler for doctors, clinics, diagnostic branches and pharmacies — scheduling and teleconsult only, never an EMR |
| YAKAP claims, capitation, empanelment | SeriousMD, mWell HealthSuite, BluHealth, DigiHealth, Soltech (PhilHealth-certified) | Out of scope. We sit beside the clinic's certified vendor and never charge for it |
| Health guides and SEO content | ClinicFinderPH | Guides link directly into the Case File and Cost Clarity tools |
| AI phone assistant for practices | Zocdoc | Last in the pipeline, delivered as a Viber/Messenger booking bot |
| Doctor directory profile and booking | NowServing, Zocdoc | Doctor dashboard with real calendars, multi-clinic availability and teleconsult; profiles show coverage accepted and a cost estimate before booking |
| Private doctor EMR, charting, billing, claims | SeriousMD | Deliberately excluded — front office only |
| Wellness and fitness content | mWell | Deliberately excluded |

---

## 5. Signature features

### 5.1 Cost Clarity

**Question it answers:** "How much will this consult, test or medicine cost me?"

**Designed around the core journey:** estimates can be shown per item or for a whole episode (consult + tests + medicines).

**How the estimate is stacked, in order:**
1. Facility's listed price or price range for the service.
2. HMO coverage, if the patient has linked a plan.
3. PhilHealth benefit (YAKAP for eligible consults and tests at the patient's registered clinic; case rates for admissions).
4. Remaining GAMOT medicine balance for the year, for covered medicines at accredited pharmacies.
5. Statutory discounts (senior citizen, PWD).
6. Travel: estimated fare range and travel time from the patient's barangay, so a "free" option far away can be compared honestly with a nearby paid one.
7. Result: estimated out-of-pocket cost as a range, with and without travel.
8. If the remaining amount is high: "You may be eligible for assistance," linking to the Case File.

**Every estimate shows its data quality:**
- *Confirmed by facility* (with date)
- *Reported by patients* (number of reports, most recent date)
- *Estimated* (regional typical range)

**Rules:**
- Always show a range, never a guaranteed number.
- Never state an assistance amount as promised; only show possible eligibility.
- Disclaimer on every estimate: final billing is set by the facility.
- YAKAP and GAMOT balances are patient-entered or patient-confirmed unless an official data connection exists.

**How price data is collected:** diagnostics and clinics enter prices in the provider portal (required for the "Price Transparent" badge), patients report after a visit, PhilHealth benefit rules come from published circulars, and fares come from local partners and patient reports.

### 5.2 Family & OFW Circle

**Question it answers:** "How do I take care of Mama's health from Dubai?"

**Roles inside a circle:**

| Role | Can do |
|---|---|
| Patient | Owns their record; grants and revokes access |
| Care manager | Book, reschedule, view appointments, prescriptions, results and case files |
| Payer | Pay for bookings, tests and medicine reservations; see receipts, not medical details unless also a manager |
| Viewer | Receive visit updates only |

**Key flows:**
- Adult child (local or abroad) books a YAKAP follow-up or lab test for a parent in the province; the facility sees who booked and who the patient is.
- The parent receives an SMS with the booking code and directions, no app needed.
- Payment in PHP via GCash, Maya, cards, and international cards for OFWs.
- Viber, SMS or push updates to the circle: "Checked in," "Seen," "Results ready," "Medicine reserved," "Medicine picked up."
- Maintenance medicine refill reminders to both the patient and the care manager, linked to a pharmacy with stock.
- Shared family health vault: prescriptions, lab results, clinical abstracts, IDs needed for assistance.

**Consent (non-negotiable):**
- An adult patient must approve each circle member, with OTP to the patient's own number or in-person confirmation at a partner facility.
- Access is scoped per role and revocable anytime; the patient sees an access log.
- Guardian flows for minors and for adults who legally cannot consent follow separate, documented rules.

### 5.3 Assistance Case File

**Question it answers:** "What help can we get for this hospital bill, and what do we bring?"

**Flow:**
1. **Program matcher:** a short questionnaire covering situation (outpatient, admitted, dialysis, chemo, medicines), hospital type, and PhilHealth status. It returns the programs that may apply: PhilHealth, YAKAP/GAMOT, Malasakit Center (DOH MAIFIP, PCSO IMAP, DSWD AICS), LGU aid, and relevant NGOs.
2. **Document checklist:** generated for the matched programs, with each document's status (have, missing, expiring). For example, a clinical abstract dated more than 3 months ago gets flagged for DSWD.
3. **Upload and organize:** family members can contribute photos and scans to one encrypted case file. Lab results from partner diagnostics can be added directly.
4. **Where to go:** nearest Malasakit Center (often at a DOH regional hospital, which may be in another city) or PCSO/DSWD field office, with hours, travel estimate, and the official online application channel where one exists.
5. **Status tracker:** the family logs each step (submitted, GL received, applied to bill) and gets reminders for follow-ups and expiring documents.

**Boundaries:**
- We prepare and organize; we never submit applications or act as an intermediary.
- The feature stays free, ad-free and politically neutral: no politician branding and no paid placements anywhere near assistance content.
- Program rules change often (e.g., 2026 guarantee-letter rules), so every program page has an owner, a source link and a review date.

---

## 6. Users and surfaces

| User | Surface | Core jobs |
|---|---|---|
| Patient | Native app (Android first, then iOS); public web for discovery; transactional SMS | Find, estimate, book, reserve medicines, manage records, get assistance |
| Assisted-booking staff (partner pharmacy or diagnostics counter) | Provider portal | Book or reserve on a walk-in patient's behalf with their consent |
| Family member / OFW | App, web | Book for others, pay, receive updates, manage refills |
| Doctor (any PRC-licensed, pilot province) | Doctor dashboard (web) | Profile and clinic affiliations, availability rules, calendar, appointments, teleconsult room, consult summary to the patient's vault |
| YAKAP clinic | Clinic portal (web) | Profile, YAKAP badge, schedule, bookings, queue status, reminders |
| Diagnostic center | Diagnostics portal (web, multi-branch) | Branches, test catalog, prices, prep instructions, slots, home service, result delivery |
| Pharmacy | Pharmacy portal (web, mobile-friendly) | GAMOT status, stock flags, reservations, refill requests |
| Public facility (optional partner) | Lightweight portal | Services, OPD hours, wait-time updates, Malasakit desk info |
| Internal team | Admin console | Verification (PRC, DOH/FDA licenses, accreditation), data freshness, moderation, program content |

---

## 7. Release plan

Build order follows supply, not demand. Nothing patient-facing ships until there
are real calendars to book against.

### Stage 1 — Admin console (internal, first)
- Facility, practitioner and service records; verification workflow (PRC, DOH/FDA licences, YAKAP and GAMOT accreditation).
- Import and clean-up tools for public data (facility registry, accreditation lists).
- Price entry and review; coverage program rules with version and source.
- Roles, permissions and the access log.
- Data-freshness dashboard: what was verified, when, by whom.
- This is also the tool the field reps use, so it ships before any partner sees anything.

### Stage 2 — Doctor and provider dashboards
- **Doctor dashboard:** own profile, clinic affiliations, availability rules, calendar, appointment list, patient context for the visit, no-show reminders.
- **Scheduler:** recurring availability (clinic days, session blocks), slot length per service, buffers, capacity per slot, blackout dates, holidays, leave.
- **Calendar bookings:** month, week and day views; drag to reschedule; manual booking for walk-ins and phone calls; queue position for clinics that run first-come-first-served.
- **Teleconsult:** scheduled video room per appointment, waiting room, consult status, post-consult summary and file send to the patient's vault.
- **Clinic, diagnostics and pharmacy portals:** services and prices, branch slots, prep instructions, GAMOT status and stock flags.
- Assisted booking by reps and partner counters (bookings exist before the patient app does).
- Transactional SMS confirmations and reminders.

### Stage 3 — Patient app (Android, Kotlin) and public website
- Search with coverage filter; **Cost Clarity v1** for consults, common lab tests and GAMOT-covered medicines, including travel estimates.
- Booking against the live calendars from Stage 2, including teleconsult appointments.
- **Family & OFW Circle v1:** book for others, local and international payments, visit updates.
- **Assistance Case File v1:** program matcher, checklists, document vault, office finder.
- Health vault: results, prescriptions and consult summaries sent by providers.
- Verified reviews after completed visits.
- Public website: facility and municipality pages, cost estimates without an account, SEO guide hub in Filipino and English, one-page payment link for family abroad.

### Stage 4 — iOS and depth
- iOS (Swift) patient app.
- Medicine reservations and refill reminders.
- Diagnostics home-service booking and results delivery to the vault.
- Queue and wait-time alerts, including public OPDs.
- HMO plan linking.
- Assisted booking through barangay health workers under municipal agreements.
- AI Taglish symptom-to-care search.
- Wave 1 rollout (rest of CALABARZON, Central Luzon, Oriental Mindoro), including boat and ferry travel estimates.
- Disaster mode.

### Stage 5 — Expansion
- Wave 2 (Mindanao cluster: Regions IX, X, XI, XII) with Cebuano and Chavacano support.
- Wave 3 (Western and Eastern Visayas, rest of MIMAROPA) with Hiligaynon and Waray support.
- Metro Manila as a referral destination for provincial patients.
- Medicine delivery.
- LGU and provincial health office data dashboards (anonymized, aggregated).
- Family plans and subscriptions.
- Last in the pipeline: conversational booking bot on Viber, Messenger and SMS, once every other surface is stable.

---

## 8. Core data model (first pass)

- **Location:** region, province, municipality and barangay using PSGC codes
- **Facility:** type (YAKAP clinic, diagnostic center, pharmacy, hospital public/private, RHU, barangay health station, health center, private clinic), parent organization (for chains), PSGC location, point (PostGIS), licenses, hours, verification status, last_verified_at
- **Practitioner:** PRC number, specialties, affiliations to facilities; profile claim status
- **Service:** consult, lab test, imaging, procedure, medicine; linked to facility
- **ServicePrep:** preparation instructions per test (fasting, timing, what to bring)
- **PriceItem:** service, facility, amount or range, source (facility / patient / estimate), observed_at
- **CoverageProgram:** PhilHealth YAKAP, GAMOT, HMO plans, discounts, assistance programs; with rules version and source URL
- **Accreditation:** facility ↔ coverage program, valid_from, valid_to, source
- **StockReport:** pharmacy, medicine, available flag, reporter type (pharmacy / patient), reported_at
- **TravelEstimate:** origin barangay or municipality, destination facility, legs with mode (tricycle, habal-habal, jeepney, van, bus, boat, ferry), fare range, time range, schedule notes, weather-dependent flag, source, observed_at
- **FacilityStatusUpdate:** facility, status (open, limited, closed), reason (typhoon, flood, power outage, other), reported_by, valid_until
- **ReferralPath:** from facility, to facility, service or level of care
- **Reservation:** pharmacy, medicine, patient, reserved_by, status, pickup window
- **RefillSchedule:** patient, medicine, interval, preferred pharmacy, reminder recipients
- **User / PatientProfile:** separate login identity from patient record (a patient may not have an app account); patient-entered YAKAP clinic and GAMOT balance
- **CareCircle / CircleMembership:** role, consent method, granted_at, revoked_at
- **AccessLog:** who viewed or changed what, when
- **Schedule:** practitioner or facility resource (room, machine, branch), service types offered, timezone
- **AvailabilityRule:** schedule, weekday or recurrence, start and end time, slot length, capacity per slot, buffer before and after, valid_from, valid_to
- **ScheduleException:** schedule, date or range, type (blackout, holiday, leave, extra session), reason
- **Slot:** schedule, start, end, capacity, remaining, mode (in_person, teleconsult), generated from rules and exceptions
- **Appointment:** patient, booked_by, channel (app, web, assisted_counter, sms, bot), facility, practitioner, service, slot, mode (in_person, teleconsult), status, payment (online or pay at counter), home_service flag
- **AppointmentEvent:** appointment, event (booked, rescheduled, cancelled, no_show, checked_in, seen, completed), actor, at
- **TeleconsultSession:** appointment, room reference, scheduled_start, joined_at per participant, ended_at, duration, outcome, technical_failure flag
- **ConsultSummary:** appointment, practitioner, summary text and attachments released to the patient's vault; never a clinical record system of its own
- **Payment:** payer, amount, method, currency, gateway reference
- **CaseFile:** patient, situation, matched programs, status timeline
- **CaseDocument:** type, issued_at, expires_at, encrypted file reference
- **Review:** appointment or reservation (required), ratings, text, moderation status

---

## 9. Proposed stack

| Layer | Choice |
|---|---|
| Patient app (rule) | Native only: Kotlin for Android, Swift for iOS. The patient experience — search, cost clarity, booking, family circle, vault, case file — lives here, not on the web |
| Web | Next.js: admin console, doctor dashboard, provider portals, public website and SEO pages, API and webhooks. No patient web app |
| Scheduling | Slots generated server-side from availability rules and exceptions; all times stored UTC, rendered in `Asia/Manila`; booking writes go through a transaction that prevents double-booking a slot |
| Teleconsult video | Managed WebRTC provider with short-lived per-appointment room tokens (compare Daily, LiveKit, Twilio Video for cost and PH latency); never record a consultation |
| Provider portals | Routes inside the Next.js app, role-based per segment (clinic, diagnostics, pharmacy) |
| Shared logic | Server-side API: coverage stacking, travel estimates, pricing, booking rules and validation run on the server so the Kotlin and Swift clients stay thin and never re-implement them |
| Codebases | Three: Next.js web, Kotlin Android, Swift iOS. Android ships first |
| Database | PostgreSQL with PostGIS (e.g., Supabase), row-level security for circle and provider permissions |
| Search | Typesense or Meilisearch with geo filtering |
| Files | Encrypted object storage with signed, short-lived URLs |
| Payments | Local gateway supporting GCash, Maya, cards and international cards (e.g., PayMongo or Xendit; compare fees) |
| Messaging | SMS provider (primary for confirmations), native push via FCM and APNs; Viber Business Messages and Messenger added with the bot at the end of the pipeline |
| Offline and low data | Native local cache of recent listings and the vault; compressed images; SMS fallbacks for confirmations |
| Non-app access | Until the bot ships: public web pages (facility, cost estimate, guides), assisted booking at partner counters and by field reps, SMS booking codes and a one-page web payment link for family abroad |
| App distribution | Play Store and App Store developer accounts; native push via FCM and APNs; separate release cycles and review times |
| Geography | PSGC codes for all locations; travel estimates stored per municipality pair |
| Localization | i18n framework from day one (Filipino and English first; Cebuano, Hiligaynon, Waray, Chavacano by wave) |
| AI | LLM-based search assistant with strict emergency escalation and no diagnosis claims |

---

## 10. Compliance checklist

- Data Privacy Act (RA 10173): health data is sensitive personal information. Register with the NPC, appoint a DPO, run a privacy impact assessment, get explicit consent, encrypt, and keep access logs.
- Data sharing agreements with partner clinics, diagnostics and pharmacies covering results delivery and booking data.
- Assisted booking at partner counters requires the patient's consent at the counter, recorded in the access log.
- Any barangay health worker program runs under a written agreement with the municipal health office.
- Circle access requires the patient's own consent; document guardian and incapacity rules with legal counsel.
- Verify practitioners against PRC before any profile goes live or any calendar accepts bookings; re-check on licence expiry. Record who verified and when.
- The platform is not a clinical record system and does not practise medicine: no charting, no triage decisions presented as medical advice, no diagnosis.
- Doctor agreements must state that the doctor owns the clinical relationship and record; the platform provides scheduling, the consult room and document delivery only.
- Do not imply PhilHealth endorsement; use program names descriptively and follow any PhilHealth branding rules.
- Review FDA rules before medicine reservations, and again before delivery.
- Review DOH and PhilHealth telemedicine guidelines and PRC rules on remote practice before the first teleconsult, not after — teleconsult is now in Stage 2.
- Confirm the current rules on electronic prescriptions issued after a teleconsult before building any prescribing flow; until then, a doctor uploads a prescription as a file to the patient's vault.
- Teleconsult sessions are never recorded. Only metadata (times, duration, outcome) is stored.
- The platform is not a clinical record system: consult summaries are documents released to the patient, not an EMR.
- Cost estimates and assistance content carry clear disclaimers and source dates.
- Get a local health-law review before launch.

---

## 11. Success metrics

- **Patients:** searches per week, share of searches using the coverage filter, booking conversion, repeat bookings within 90 days
- **Core journey:** share of patients who use two or more of consult, diagnostics and pharmacy within 60 days
- **Cost Clarity:** share of listings with confirmed prices; post-visit "estimate was accurate" rating
- **Family Circle:** share of bookings made for someone else; share paid from abroad; active circles
- **Case File:** case files created, checklists completed, self-reported assistance received
- **YAKAP clinics (free segment):** bookings per clinic, no-show rate vs. baseline, follow-up completion. Measured as supply health, not revenue
- **Diagnostics:** completed bookings per branch, share of patients arriving prepared
- **Pharmacies:** stock reports per week, reservations picked up, refill reminder conversion
- **Provincial access:** share of municipalities in the pilot area with a verified option for each of primary care, diagnostics and medicines; trips with stock or hours confirmed before travel; share of bookings via bot, SMS or assisted counters
- **Resilience:** share of facilities in affected municipalities with a status update within 24 hours of a declared weather event
- **Doctors:** PRC-verified doctors onboarded, share with a live calendar, bookings per doctor per month, share of doctors still active after 90 days, share offering teleconsult
- **Scheduling health:** share of partner calendars with live availability, slot fill rate, no-show rate, reschedules per booking
- **Teleconsult:** consults completed, share ending in technical failure, repeat teleconsult rate
- **Supply health:** share of listings verified in the last 90 days

---

## 12. Risk register

Each risk has an owner decision, an early-warning signal to watch, and what to do
when the signal fires. Review this at every stage gate.

### R1 — YAKAP clinics are already served by certified vendors
**Severity: high. Status: addressed.**
PhilHealth's Certified Service Provider programme (~29 vendors under YAKAP 1.1,
including SeriousMD, mWell HealthSuite, BluHealth, DigiHealth and Soltech) covers
claims, capitation and empanelment. Certification needs EMR functions we exclude.
- *Done:* clinic subscription revenue removed from the plan and the budget.
- *Watch:* clinics declining to list at all because they see us as a competing vendor.
- *If it fires:* lead the pitch with "which YAKAP system do you use?" and position
  as the patient-facing layer beside it. Open a partnership conversation with one
  certified vendor rather than building toward certification.

### R2 — Cold start: no patients without partners, no partners without patients
**Severity: high. Status: open.**
The budget assumes ~90 partners per province maturing over 18 months on two reps.
- *Watch:* month 9 — partners with a live calendar, and share of partner-reported
  stock flags updated in the last 7 days.
- *If it fires:* shrink the pilot to the hub city only, concentrate both reps on
  diagnostics and pharmacies, and delay doctor recruitment.
- *Mitigation already in the plan:* assisted booking means a partner gets value
  from day one without patient volume.

### R3 — Data freshness decays faster than two reps can maintain it
**Severity: high. Status: open.**
Prices, hours, stock and verification dates decay weekly. "Confirmed before you
travel" is the core promise, and it degrades silently.
- *Watch:* share of listings verified in the last 90 days; share of same-day stock
  confirmations answered within an hour.
- *If it fires:* narrow the verified set rather than showing stale data. Better to
  cover fewer municipalities accurately than all of them badly. Show an explicit
  "not recently verified" state instead of hiding the date.

### R4 — A wrong cost estimate destroys trust irreversibly
**Severity: high. Status: open.**
HMO rules are often contractual and not public; GAMOT balances are patient-entered
and unverifiable; facility prices drift.
- *Before building:* test the stacking logic against 20 real cases with actual
  receipts, and record the error rate.
- *Watch:* post-visit "estimate was accurate" rating; any case where a patient
  travelled and the estimate was materially wrong.
- *If it fires:* widen ranges, downgrade the source label, or stop showing an
  estimate for that service and show only the facility's own price.
- *Never:* present an estimate as a guaranteed price, or an assistance amount as approved.

### R5 — Regulatory load is front-loaded by teleconsult in Stage 2
**Severity: medium-high. Status: open.**
Teleconsult brings DOH AO 2020-0013, PhilHealth Circular 2021-0013 on teleconsult
reimbursement at accredited providers, e-prescription rules requiring the
physician's PRC number with added restrictions on controlled substances, and
RA 10173 with NPC registration and a DPO — all before revenue.
- *Before Stage 2 ships:* a health-law review covering teleconsult, consent, data
  sharing and the doctor agreement.
- *If budget is tight:* ship the calendar and scheduler first and hold teleconsult
  until the review clears. The scheduler alone is still useful to a doctor.

### R6 — Doctor supply is thinnest exactly where we launch
**Severity: medium-high. Status: open.**
Physician maldistribution outside Metro Manila is the structural problem; the
province that needs help most has the fewest doctors to recruit.
- *Watch:* month 9 — PRC-verified doctors onboarded against the target of 25.
- *If it fires:* recruit through the clinics and hospitals already onboarded rather
  than direct outreach, and reconsider opening teleconsult to doctors outside the
  province (currently a decided "no" — reopening it is a deliberate strategy change,
  not a quiet workaround).

### R7 — Teleconsult cannot be monetized against free alternatives
**Severity: medium. Status: addressed in positioning.**
Competitors run roughly ₱120–₱750 per consult, or about ₱150/month unlimited;
Medgate is free for some HMO members.
- *Done:* teleconsult repositioned as a doctor-side feature for their own patients,
  with modest revenue expectations.
- *If it fires:* make teleconsult free and monetize the scheduler and multi-clinic
  availability instead.

### R8 — Build surface is large for one developer
**Severity: medium-high. Status: open.**
Next.js, Kotlin, Swift, WebRTC, payments, scheduling and a consent model.
- *Watch:* whether Stage 2 ships within its planned window.
- *If it fires:* delay iOS indefinitely (Android covers most provincial patients),
  and use a managed video provider rather than anything self-hosted.
- *Standing rule:* all business logic server-side, so the native clients stay thin.

### R9 — Government platforms expand into this space
**Severity: medium. Status: monitor.**
YAKAP registration already runs through eGovPH and the PhilHealth portal, and mWell
is a certified Clinic Management System replacing eKonsulta.
- *Watch:* any official booking, cost-estimate or assistance-tracking feature shipping
  in eGovPH or the PhilHealth portal.
- *If it fires:* integrate rather than duplicate, and fall back to the parts government
  platforms are unlikely to build: travel reality, pharmacy stock, family and OFW
  access, and private-sector price comparison.

### R10 — The assistance feature costs forever and earns nothing
**Severity: low-medium. Status: accepted.**
Program rules shift often (2026 GAA anti-epal provisions, AO 2026-0031).
- *Accepted as the price of trust.* Keep it free, ad-free and politically neutral.
- *Control the cost:* every program page has one owner, a source link and a review
  date; review quarterly, not continuously.

### R11 — Competitors reach provinces before we do
**Severity: medium. Status: monitor.**
mWell already serves underserved sectors (around 37% of users) and runs BangkaHealth
boats to island barangays; SeeYouDoc has LGU integrations in several municipalities.
- *Watch:* any competitor announcing a programme in the pilot province.
- *If it fires:* depth beats breadth. Own every municipality in one province
  completely rather than racing across regions.

### R12 — Single-founder concentration
**Severity: medium. Status: open.**
One person holds the product, the code and the partner relationships.
- *Mitigation:* document partner agreements and field processes in the admin console
  rather than in your head; keep the repo and infrastructure access recoverable by
  someone else; avoid any commitment that requires you personally to be available daily.

---

## 13. Decisions and open questions

**Decided**
- Provider focus: YAKAP clinics, diagnostics and pharmacies. Private specialists get free claimable listings only; no SeriousMD integration planned.
- Build order: admin console → doctor and provider dashboards (calendar, scheduler, teleconsult) → patient app.
- Doctors are a full segment: all PRC-licensed doctors in the pilot province, any specialty. Scope is front office only — calendar, scheduler, teleconsult, consult summaries. No EMR, no billing, no claims.
- YAKAP clinics are free. No subscription revenue is modelled from them; PhilHealth-certified vendors own the claims and capitation workflow and we do not compete for it.
- Teleconsult is a doctor-side feature for their own patients, not a consult marketplace competing on price.
- Doctor recruitment stays inside the pilot province; teleconsult is not opened nationwide at this stage.
- Teleconsult is in Stage 2, not a later phase.
- Launch geography: provinces first. Metro Manila later, mainly as a referral destination.
- Regions in scope: III, IV-A, IV-B (MIMAROPA), VI, VIII, IX, X, XI, XII.
- Working name: TBD.

**Open**
1. Pilot province: score candidates in section 3.2 (current recommendation: a CALABARZON province within driving distance of Makati; alternative: South Cotabato or Cagayan de Oro with a local field lead).
2. Local partner or field team in the pilot province, and a Mindanao field hub location for Wave 2.
3. Brand name (TBD) and trademark check.
4. Doctor monetization: what sits behind the paid tier (multi-clinic schedules, teleconsult, analytics) and at what price — test with the first cohort. Expect low willingness to pay while free alternatives exist.
5. Whether to pursue a partnership with a PhilHealth-certified YAKAP vendor for availability and booking integration, and which one.
6. Diagnostics pricing: per completed booking vs. per-branch subscription.
7. Pharmacy monetization: which tools are paid (reservations, refills, delivery) vs. free.
8. Confirm current YAKAP capitation mechanics with PhilHealth circulars, to understand what clinics are paid for and where booking volume helps them.
9. First diagnostic chain and pharmacy partners to approach.
10. Municipal health office engagement: public-data listing only at launch, or early outreach for verified updates and barangay health worker assisted booking.
11. Legal review of consent flows (including assisted booking), data sharing with partners, and medicine reservations.
