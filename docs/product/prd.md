# Wandr — MVP Product Requirements Document

**Status:** Product-approved — implementation questions and release blockers remain explicitly tracked below.
**Tracking:** [Issue #1](https://github.com/moralesbang/wandr/issues/1)
**Sources:** [Product vision](../vision.md), [Product and technical handoff](../handoff.md), and the product-definition interview for issue #1.
**Vocabulary:** [Domain glossary](../../GLOSSARY.md)
**Artifact language:** English. This does not determine the application's supported UI languages.

## 1. Purpose and precedence

This PRD consolidates existing product decisions rather than restarting product discovery. It defines the MVP's scope, functional requirements, business rules, acceptance criteria, success signals, and unresolved questions.

The explicit interview decisions captured here supersede conflicting MVP proposals in the source documents. In particular, Notes, Collections, account blocking, and data export are excluded; streaks use a date-based 48-hour window; and steps are measured only during Walks recorded with Wandr, without estimates or external health integrations.

This document is a product specification, not a database schema or implementation plan. Unresolved decisions are identified explicitly; they must not be filled in silently during implementation. Existing technical stack decisions remain in the handoff.

## 2. Product vision and principles

**Wandr is a personal walking journal and a collective atlas of small discoveries: a place to walk, observe, remember, and rediscover without competing for attention or performance.**

Two experiences have equal importance:

- **My world:** preserve walks, photographs, observations, and personal activity history, even without publishing anything.
- **The world of others:** discover public Finds and Routes, save inspiration, and optionally contribute one's own experiences.

The cycle to validate is **walk → remember → choose whether to share → discover → save**. Sharing is optional, not a condition of personal value.

### Product principles

1. Walking is enough; no minimum speed, distance, or performance goal is required.
2. Memories and observations matter as much as GPS data.
3. Personal journaling and collective discovery deserve equal attention.
4. Content remains useful beyond its publication date; popularity is not the product's organizing principle.
5. Identity is pseudonymous, not guaranteed anonymous. Public handles, real names, and personal photographs are not required.
6. Privacy is a functional requirement. Nothing is published automatically, and public live tracking is prohibited.
7. Motivation is gentle: private statistics, no competitive rankings, and no shaming messages.
8. The experience is cozy, editorial, calm, accessible, and photograph-led. ASCII art is an optional visual accent, not a core feature.

## 3. Audience and needs

### Initial audience

- People who walk for pleasure, calm, curiosity, and everyday exploration.
- People interested in street photography, architecture, parks, cafés, and small local details.
- People who want a personal record without sports-performance pressure.
- People who discover future walks through other people's observations and routes.

### Core needs

- Record a walk without needing GPS, photographs, or public exposure.
- Preserve discoveries independently of the walk that produced them.
- Understand a personal walking habit without competing with others.
- Choose exactly which resources to publish and withdraw them later.
- Find and save ideas for future walks without installing the mobile app first.

## 4. Scope and platform responsibilities

### Included

- Email/password accounts, email verification, password recovery, and optional public pseudonymous profiles.
- Private Walk creation and editing, manual entry, mobile GPS recording, photographs, local recovery, and offline capture.
- Finds with a photograph or text, optional Walk association, optional public location, and predefined tags.
- Routes derived from recorded Walk geometry, with two public-geometry choices and mandatory map review.
- Independent, explicit publication and withdrawal of Walks, Finds, and Routes.
- Public web Explore, public resource pages, map/list views, area/tag filters, and private saves.
- Private journal, activity statistics, date-based streaks, and measured steps from Wandr recordings.
- Reports, web-only manual moderation, account suspension, and account deletion.
- Public-media sanitization, resource-level authorization, and separation of private tracks from public geometry.

### Platform matrix

| Capability | Mobile | Web |
| --- | --- | --- |
| Create/edit Walks, Finds, Routes | Yes | No |
| Record GPS and steps; offline capture | Yes | No |
| Private journal and statistics | Yes | No |
| Explore and public resource pages | Yes | Yes; publicly accessible and indexable |
| Manage saves and profile | Yes | Yes |
| Report public content | Yes | Yes |
| Administrative moderation | No | Yes; administrators only |

Accounts are shared across clients. Public web discovery must work without installing the mobile app. Account-deletion entry points and device support details remain subject to OQ-10 and OQ-12.

### Explicitly out of scope

- Notes/comments, Collections, account blocking, follows of people/places/topics/collections, direct messages, and “I've been here” interactions.
- Unlisted-link visibility, public statistics, follower counts, and recent-activity feeds.
- Data-export UI/downloads and reimport.
- Step estimates, whole-day background activity totals, external health/app integrations, and wearables.
- Route drawing from scratch, route-file imports, adjustable trimming sliders, and configurable private exclusion zones.
- Web editors for Walks, Finds, or Routes.
- Social login providers, automated moderation, and in-app appeals.
- Competitive rankings, viral/infinite engagement feeds, turn-by-turn navigation, AI recommendations, music integrations, seasonal summaries, neighborhood statistics, and advanced ASCII tools.

Excluding export or blocking does not remove applicable legal obligations or the need to assess launch safety.

## 5. Functional requirements and acceptance criteria

Requirement IDs are stable references. Acceptance criteria describe observable behavior, not a prescribed implementation.

### 5.1 Identity and accounts

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| ID-01 | Support email/password registration, sign-in, sign-out, email verification, and password recovery. | A person can create an account, verify their email, sign in/out, and recover access. Invalid credentials or invalid/expired recovery credentials do not grant access. |
| ID-02 | Require verification for publication and reporting, not for anonymous discovery. | An unverified account cannot publish or submit reports. A visitor can browse public Explore and resource pages without signing in. |
| ID-03 | Do not require a public handle, real name, face photograph, or Instagram account. | Account creation and private journaling succeed without those fields or an enabled public profile. Public profile URLs use opaque identifiers rather than user-chosen handles. |
| ID-04 | Allow account deletion with explicit confirmation. | After the server confirms deletion, the account's publications are unavailable through Wandr's public surfaces and its private information enters the deletion process. Its Finds and Routes are not reassigned to the community. Final storage/backup deadlines must follow the policy resolved in OQ-08. |

### 5.2 Walks and recording

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| WALK-01 | Allow manual creation with only the walk's date. | A Walk can be saved without title, text, photos, duration, distance, end time, or GPS. It is private and can be edited later. Missing measurements are not displayed as measured zeros. |
| WALK-02 | Record GPS on mobile when permission and device support are available. | A user can start and finish a recording. Denying location permission does not prevent manual Walk creation. Recording limitations are disclosed rather than presented as uninterrupted coverage. |
| WALK-03 | Preserve available recording data locally and recover after interruptions. | Offline recording data already persisted is recoverable after relaunch in the supported test scenarios. Missing GPS segments are identified and are not filled with invented track data. The supported interruption matrix is defined under OQ-01. |
| WALK-04 | Allow adding photographs, text, and linked Finds, and editing the private Walk after recording. | An owner can update their Walk. Other accounts cannot read or edit its private fields. Adding private material does not silently update a published view. |
| WALK-05 | Publish a Walk as a selected journal view, never as its private track. | The public representation contains selected title/text/photos, but no GPS track, walk date, exact time, duration, or distance. Those private fields are absent from public responses, not merely hidden in the UI. |
| WALK-06 | Preserve independent Finds and Routes when deleting their source Walk. | The deletion confirmation explains what is removed and retained. After deletion, the Walk and its public journal are unavailable; its Finds and Routes remain with the same owner, with the Walk association removed. |

### 5.3 Finds and media

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| FIND-01 | Require at least one photograph or nonempty text. | A text-only or photo-only Find can be saved without a Walk or location. A Find with neither is rejected. |
| FIND-02 | Keep public location opt-in and independent of photo metadata. | The default is no public location. A user can choose no location, an approximate area, or an explicitly selected exact point. Photo coordinates do not automatically become public Find coordinates. |
| FIND-03 | Explain location precision honestly. | Approximate locations render as areas, not falsely precise pins. Publishing an exact point requires a warning and confirmation. Finds without location do not appear as map pins. Area precision is resolved under OQ-03. |
| FIND-04 | Keep discovery dates private. | The Find's occurrence date and exact time are absent from public representations. User-authored text or imagery may still reveal them; the publication flow warns about this limitation. |
| MEDIA-01 | Keep originals private and sanitize public derivatives. | A private original is not accessible to another account or a public visitor. Public derivatives contain no sensitive EXIF metadata, including embedded coordinates. Public publication never exposes the original's private URL. |
| MEDIA-02 | Make capture and upload state visible and retryable. | Photos can be retained offline. A pending or failed upload is distinguishable from a completed upload, and failed uploads can be retried without falsely reporting success. File limits and retry/conflict details are resolved under OQ-05 and OQ-09. |

### 5.4 Routes

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| ROUTE-01 | Create Routes only from a Walk with GPS geometry in the MVP. | A Route is a distinct owned resource derived from an eligible Walk, not the Walk itself. A Walk without geometry cannot produce a Route. No drawing-from-scratch or file-import workflow is offered. |
| ROUTE-02 | Require title, description, and reviewed public geometry before publication. | Missing title, description, or map review prevents publication. A saved Route starts private. |
| ROUTE-03 | Offer exactly two geometry choices and a map preview. | “Hide start and end” is selected by default; the alternative is “Show full route.” There are no trimming sliders. Showing the full route presents a location-exposure warning. The selected geometry is previewed before confirmation. |
| ROUTE-04 | Apply the agreed trimming rule along the recorded path. | For length L > 400 m, remove 200 m from each end. For 0 < L ≤ 400 m, remove 25% of L from each end. For example, 1,000 m leaves 600 m and 400 m leaves 200 m. This is distance along the path, not a radius around endpoints. Invalid/empty geometries are handled according to OQ-02. |
| ROUTE-05 | Separate the public Route from its private source track. | A public Route response contains only its reviewed public geometry and public fields, not the source track, recording timestamps, or private source-Walk details. Updating the source Walk does not update the Route automatically. |
| ROUTE-06 | Disclose that geometry controls reduce risk, not guarantee anonymity. | The publication experience does not claim that trimming prevents identification of homes, workplaces, routines, or locations inferred from multiple Routes. |

### 5.5 Publication, privacy, and withdrawal

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| PUB-01 | Support only private and public resource visibility. | New resources are private. Only an explicit owner action publishes them. Possession of a private resource URL never grants another person access. No unlisted visibility option is offered. |
| PUB-02 | Publish related resources independently. | Publishing a Walk does not publish its Finds or Routes; publishing a Find or Route does not publish its Walk. Public links reveal only related resources that are also public. |
| PUB-03 | Require review and confirmation for public updates. | Adding private photos or editing private data leaves the existing public representation unchanged until the owner confirms an updated public view. Withdrawal does not require publication review. |
| PUB-04 | Allow an owner to withdraw or delete published resources. | Once the server confirms withdrawal, the content is unavailable through Wandr Explore, public profiles, public resource/media access, and other users' saves. A save does not retain a copy or access rights. External copies and search-engine caches are not promised to disappear immediately. |
| PUB-05 | Never publish live tracking or private temporal/location metadata. | Public responses, media derivatives, page metadata, and rendered pages do not expose private tracks or occurrence dates/times. A live mobile recording is not publicly broadcast. |
| PUB-06 | Do not imply anonymity through pseudonymity. | Publication guidance explains that photos, text, exact pins, full Routes, and external profile links can reveal identity or sensitive locations. |

### 5.6 Explore and saves

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| EXP-01 | Make public Finds and Routes discoverable in map/list views. | Visitors can open Explore and public resource pages without an account. Walks are not Explore results; they remain accessible by public link or an enabled public profile. Unlocated Finds can appear in lists but not as map pins. |
| EXP-02 | Filter by area and predefined tags. | Selecting an area or tag restricts results to matching public content. Older matching content remains eligible; discovery is not exclusively chronological or ranked by likes. Exact ordering and unlocated-Find filter behavior are resolved under OQ-06. |
| EXP-03 | Support manual area selection and optional “near me.” | A visitor can explore without location permission. Location is requested when “near me” is chosen, and denying it leaves manual area selection available. Search location is not published. |
| EXP-04 | Use a Wandr-defined tag catalog. | Users can select predefined tags for Finds and Routes, but cannot create new tags in the MVP. The initial catalog is finalized before Explore implementation. |
| SAVE-01 | Let authenticated users save Finds and Routes to a private list. | A signed-in user can save, revisit, and remove saved Finds and Routes on web and mobile. Saves are not public endorsements and do not create Collections. Visitors are asked to sign in to save. |
| SAVE-02 | Honor subsequent visibility and moderation changes. | A saved item that is withdrawn, deleted, or removed by moderation no longer exposes its content through the saved list or its old URL. |

### 5.7 Profiles

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| PROF-01 | Keep public profiles disabled by default and separate from publication. | Publishing a resource does not enable an author page. Without an enabled profile, public resources do not automatically link to an author's publication history, but remain reportable. |
| PROF-02 | Offer a minimal optional public profile. | An enabled profile can contain an avatar, optional short phrase, optional bio, optional Instagram link, and already-public content. It exposes no private resources, statistics, followers, or recent-activity feed. |
| PROF-03 | Explain identity-linking risks. | Adding Instagram displays a warning that it can connect the profile to a person's external identity. Instagram remains optional. |

### 5.8 Statistics, streaks, and steps

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| STAT-01 | Keep all MVP activity statistics private. | Only the owner can view Walk/Find counts, days with Walks, current/best streak, available distance/duration, and step statistics. There is no publish-statistics option or cross-user leaderboard. |
| STAT-02 | Distinguish measured, manually declared, and missing data. | Distance/duration totals identify manual versus measured contributions and incomplete coverage. Missing values are not represented as measured zeros. |
| STAT-03 | Count streaks as chained Walks using the date-based rule in section 6. | A date-only manual Walk can participate. The occurrence date, not upload time, determines eligibility. Current/best streaks are expressed as Walk counts, not consecutive-day counts. The example in section 6 is an acceptance fixture. |
| STEP-01 | Measure steps only during Walks recorded with Wandr. | With supported hardware and granted permission, a recording can retain measured steps. Whole-day device activity and external health-app history are not imported. Missing readings are not estimated from distance or duration. |
| STEP-02 | Preserve journaling when steps cannot be measured. | A manual Walk or recording without step readings shows “steps unavailable.” A missing permission or unsupported sensor does not prevent manual journaling. Supported recording/step scenarios are resolved under OQ-01. |
| STEP-03 | Show daily averages for the current week, current year, and account history. | Apply the formula and coverage rules in section 6. Periods include no dates before account creation or after today. A day without a recorded Walk contributes zero recorded Wandr steps, not a claim of zero real-world activity. |
| STEP-04 | Identify incomplete step coverage. | If a period includes Walks without step readings, the average is marked partial and uses only available measured steps. UI wording describes Wandr-recorded steps rather than total daily activity. |

### 5.9 Offline and synchronization

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| OFF-01 | Support offline Walk recording, Find creation, and photo retention. | The user can capture those resources without connectivity and see that synchronization is pending. Previously persisted local data remains available in the supported recovery scenarios. |
| OFF-02 | Require server confirmation for publication and withdrawal. | Offline actions do not display a successful publication or withdrawal. A withdrawal attempted offline explicitly warns that the resource remains public until the server confirms it. |
| OFF-03 | Distinguish pending, failed, and synchronized work. | Reconnecting can synchronize pending work without silently losing it or duplicating the same operation's resources. Conflict policy and retry behavior must be resolved under OQ-05. |

### 5.10 Reports and moderation

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| MOD-01 | Accept reports from verified signed-in accounts. | A reporter selects exposure of personal information, harassment/hate, inappropriate content, spam, or other, with optional explanatory text. This works without an enabled author profile. |
| MOD-02 | Keep reports private and nonautomatic. | The reported author cannot see the reporter's identity. Submitting a report alone does not automatically withdraw content. |
| MOD-03 | Provide manual administrative moderation on web only. | Authorized administrators can review reports, remove content, and suspend accounts. Nonadministrators cannot access those capabilities, and there is no mobile moderation interface. |
| MOD-04 | Record decisions and inform affected authors. | A moderation action has a recorded reason and audit entry; the author is informed of the reason. Suspending an account removes its content from public surfaces. Notification delivery and report handling targets are resolved under OQ-07. |

## 6. Business rules and calculation examples

### 6.1 Ownership and relationships

- Walks are personal experiences; Finds are persistent discoveries; Routes are reusable walking proposals.
- Each resource's publication is independent. A private relationship must not leak through a public response.
- Deleting a Walk preserves its owner's independent Finds and Routes; deleting the account does not.
- Saves are private references, not copies or access grants.
- Editing private data is not a publication action.

### 6.2 Route geometry

Let L be the source path length. “Hide start and end” retains the middle segment after removing 200 m from each end when L > 400 m; otherwise it removes L/4 from each end. “Show full route” retains the full source geometry after warning and map review. Both options publish separate reviewed geometry, never a private-track reference that exposes private fields.

This deliberately simple rule can retain more geometry near the 400 m threshold than just above it. The threshold behavior is explicit, not an anonymity guarantee. Handling gaps, invalid geometry, and zero-length recordings remains open in OQ-02.

### 6.3 Streak window

- Use the account's timezone and the date on which the Walk occurred, for both manual and recorded Walks.
- For a Walk dated D, start its 48-hour continuation window at 00:00 on D+1. The continuation cutoff is 48 hours after that instant.
- **Confirmed example:** a Walk on November 19 starts its window on November 20 at 00:00. It expires on November 22 at 00:00; a Walk on November 21 continues the chain.
- A Walk occurring before the cutoff can continue the streak. At the cutoff, the previous window has expired. The next Walk starts a new chain.
- The streak value is the number of chained Walks, not elapsed days. Do not use shaming messages or competitive rankings.
- Retroactive changes, timezone changes, and daylight-saving behavior require the explicit policy in OQ-04 before implementing the complete calculation.

### 6.4 Step averages

For each period:

1. Select the intersection of the period with the dates from account creation through today, inclusive, in the account timezone.
2. Sum the available measured steps from Wandr-recorded Walks occurring in that interval.
3. Divide by the number of calendar dates in the interval, including today. This is a daily average of recorded steps, not an average per Walk.

Periods are the current Monday–Sunday week, current calendar year, and entire account history. Future days are excluded. A day with no Walk contributes no steps to the numerator but remains in the denominator. If any Walk lacks readings, label the average partial; do not estimate its missing steps or describe the average as total physical activity.

**Fixture:** an account created on Monday is viewed on Wednesday. It has 3,000 measured steps on Monday, no Walk on Tuesday, and 1,500 measured steps on Wednesday. The weekly daily average is 4,500 / 3 = 1,500 recorded steps. Adding a manual Walk with no step data leaves the measured numerator unchanged and marks coverage partial.

## 7. Nonfunctional requirements

These preserve commitments in the source documents. Numerical performance budgets and operational limits remain open rather than being invented here.

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-01 | Enforce server-side resource authorization and private/public data separation. | Test owner, other-account, and unauthenticated access against private resources, originals, public pages, and API responses. Guessing or possessing a URL does not bypass authorization. |
| NFR-02 | Protect public rendering and indexing boundaries. | Public pages use only authorized public data. Private content is absent from public HTML, metadata, sitemaps, and public API responses. `noindex` is not treated as authorization. |
| NFR-03 | Protect the service against abuse. | Validate inputs and enforce limits on authentication, uploads, publication, and reports; test rejected requests. Exact limits are defined under OQ-09. |
| NFR-04 | Keep operational telemetry free of sensitive private location data. | Inspect application logs and analytics payloads for private coordinates, private track geometry, and sensitive media metadata. Restrict access to administrative audit data. |
| NFR-05 | Provide accessible core journeys. | Verify keyboard navigation on web, visible focus, accessible control labels, contrast, photo text alternatives, and reduced-motion support. The formal accessibility target remains in OQ-09. |
| NFR-06 | Keep discovery and media loading bounded. | Verify paginated/bounded results and optimized public image derivatives. Explore/map latency, image size, and service cost budgets are defined before release under OQ-09. |
| NFR-07 | Validate recording capabilities on physical devices. | Record results for supported OS/device combinations, permission denial, offline use, backgrounding, and interruptions. Do not promise absolute GPS or step continuity. Release support is defined under OQ-01. |

## 8. Acceptance journeys

The MVP review must demonstrate these journeys in addition to the requirement-level checks:

1. **Private-only value:** register, create a date-only Walk, add a Find, and inspect the private journal/statistics without enabling a profile or publishing anything. Another account and a visitor cannot access the content.
2. **Offline capture:** record a Walk and retain a Find/photo offline, recover persisted data after a supported interruption, reconnect, and distinguish pending versus synchronized results without duplication.
3. **Independent sharing:** publish a selected Walk journal while keeping a linked Find private; then publish the Find without exposing the private track, occurrence date, or private relationship details.
4. **Safe-by-default Route flow:** derive a Route, inspect both geometry choices, publish the default trimmed version, and verify the public response contains only reviewed public geometry and fields.
5. **Public discovery:** a visitor explores by manually selected area/tag without location permission, opens a Find/Route via web link, signs in, and saves it. An older matching item remains discoverable.
6. **Withdrawal:** withdraw a saved public resource and verify it is no longer accessible through Explore, public profile, public resource/media access, or another account's saved list. An offline attempt never falsely reports completion.
7. **Habit and coverage:** verify the November 19–22 streak fixture and the step-average fixture, including a date-only manual Walk and missing readings.
8. **Moderation and deletion:** a verified user reports content, a web administrator removes it or suspends its author, and public access disappears. Separately verify Walk deletion preserves independent Finds/Routes, while account deletion does not.

## 9. Initial success metrics

Metrics measure usefulness, not time spent in the app. Private-only users are valid successful users. Quantitative product targets will be set for the pilot rather than assumed as release gates.

| Dimension | Initial measure | Target/status |
| --- | --- | --- |
| Personal value | Number and share of pilot participants recording at least one Walk in multiple distinct weeks | Pilot observation; cohort/window/threshold open in OQ-11 |
| Discovery | Number and share of participants saving another person's public Find or Route | Pilot observation; thresholds open |
| Voluntary contribution | Number and share of participants explicitly publishing a Walk, Find, or Route | Observational, not a requirement for every user |
| Trust | Confirmed incidents exposing private data | Target: zero; an incident requires investigation and remediation |
| Community safety | Pending reports and their age/resolution time | Track from the pilot; handling target open in OQ-07 |
| Reliability | Failed uploads/sync operations and interrupted recordings with recoverable data | Engineering diagnostics; limits/support matrix open |

Analytics must not collect precise private tracks or require publication to measure activation. The measurement design and retention policy are part of OQ-08 and OQ-11.

## 10. Open questions and risks

These are deliberate gaps, not implicit feature commitments. Resolve affected questions before implementing the relevant behavior; legal, safety, and release-support questions must be resolved before public launch.

| ID | Question or risk | Required next decision |
| --- | --- | --- |
| OQ-01 | GPS, step counting, background execution, battery, and interruption recovery vary by device/OS. A guarantee of uninterrupted background recording is not part of the MVP. | Test physical devices; define supported platforms and permission flows, recovery scenarios, step availability, and honest limitations. Distinguish in-session sensor counting from excluded external health integrations. |
| OQ-02 | Routes can have gaps, zero length, loops, or invalid geometry. Trimming can still reveal sensitive places and has a discontinuity around 400 m. | Define valid source/public geometry, gap rendering, minimum publishable geometry, and preview behavior. Do not silently replace the agreed two-option flow with advanced editing. |
| OQ-03 | “Approximate area” lacks a chosen precision. | Select area granularity and public representations that do not expose the original exact point. Review aggregation/inference risks. |
| OQ-04 | Retroactive Walk creation/editing/deletion, multiple same-day Walks, future dates, timezone changes, and daylight saving can affect streaks. | Define recalculation, date validation, timezone initialization/change behavior, and DST semantics while preserving the confirmed date-only window example. |
| OQ-05 | Multi-device/offline edits, failed transfers, and delete-versus-update races can lose or resurrect data. | Define conflict resolution, retry/idempotency rules, deletion precedence, local account/session handling, and withdrawal behavior across clients. |
| OQ-06 | Explore ordering, cold start, filter combinations, and unlocated Finds need precise behavior. | Choose initial ranking/curation, map/list filter semantics, the tag catalog, and clearly identified seed content. |
| OQ-07 | Blocking is excluded, leaving users dependent on moderation. Manual review also creates response-time risk. | Define admin responsibilities, report statuses/handling targets, author-notification channel, suspension lifecycle, and an external contact/appeal process if needed. Assess whether the residual risk permits launch. |
| OQ-08 | Storage retention, account deletion, backups, public-cache revocation, analytics, and legal access/portability obligations are not finalized. | Establish deletion deadlines and revocation mechanisms, retention schedules, jurisdiction review, and any legally required manual data-request procedure. Export UI remains excluded. |
| OQ-09 | Operational and accessibility thresholds are unspecified. | Define image/file limits, rate limits, performance/cost budgets, accessibility target, supported content limits, and map-provider terms/costs before release. |
| OQ-10 | Authenticated journeys across web/mobile require detailed flows. | Specify email verification/recovery redirects, session handling, profile disabling behavior, resource review screens, and account-deletion entry points. |
| OQ-11 | Pilot targets and measurement definitions are not yet set. | Define cohort, observation window, thresholds, privacy-preserving instrumentation, and the distinction between first-time activation and ongoing personal value. |
| OQ-12 | UI language, geography, age policy, and launch distribution are not defined. | Choose supported UI languages, initial launch region/audience restrictions, and mobile distribution scope. English documentation does not itself settle localization. |

## 11. Review and completion checklist

- [x] Existing vision and principles consolidated.
- [x] Audience, core needs, MVP inclusions, and exclusions stated.
- [x] Functional requirements have unique IDs and observable acceptance criteria.
- [x] Business rules, privacy boundaries, initial metrics, and open questions documented.
- [x] Explicit scope changes from the source documents recorded.
- [x] Product review confirms this synthesis matches the agreed decisions (approved by the product owner).
- [ ] Requirement and open-question review confirms readiness to guide domain modeling, UX, and implementation planning.
- [x] Document committed to the repository.
- [ ] Repository review completed.

Product approval confirms the requirements and scope captured here; it does not resolve the explicitly open implementation questions. This PRD must not be described as fully implementation-ready while affected blockers remain unresolved. No application implementation is included in this issue.
