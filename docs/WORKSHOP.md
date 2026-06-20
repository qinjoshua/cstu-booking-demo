# 🧑‍🏫 CSTU Class Booking — GitHub Copilot Workshop Guide

This guide is for the **facilitator**. It contains the demo script, the location
of every planted bug, suggested live features to build, and talking points.
Attendees don't need to read this — it's your cheat sheet.

> **Goal:** show how GitHub Copilot helps you (1) build features, (2) find and fix
> bugs, and (3) write and run tests — using a small but realistic codebase.

---

## 0. Before you start

```bash
python server.py                      # serves http://localhost:8000
python -m unittest discover -s tests  # runs the backend test suite
```

Sign in with any username + password **`cstu2024`** (e.g. `alex.chen`).

Tip: keep two terminals open — one running the server, one for tests — and the
browser on the catalog page.

If you want a perfectly clean slate between runs, delete `data/state.json`
(it is regenerated automatically).

---

## 1. Demo: build a feature with Copilot ✨

Pick **one** of these. Each is scoped to ~5–10 minutes and touches code that
already has a natural "seam" to extend.

### Option A — "Filter by meeting day" (frontend)
The filter bar in `public/index.html` already has a search box and two dropdowns.
Ask Copilot to add day-of-week filter chips (Mon–Fri).

> Prompt idea: *"Add a row of toggle chips for Mon–Fri under the filter bar.
> When chips are selected, only show courses that meet on a selected day. Wire it
> into `applyFilters()` in app.js and style the chips in styles.css."*

Talking points: Copilot reads `applyFilters()`, infers the `course.days` shape,
and matches the existing visual style.

### Option B — "Star / favorite a course" (frontend + localStorage)
Add a ☆ button to each course card that saves favorites to `localStorage` and a
"Favorites only" toggle.

> Prompt idea: *"Add a star button to each course card in `courseCardHTML`. Persist
> favorited course ids in localStorage and add a 'Show favorites only' filter."*

### Option C — "Estimated tuition" (frontend)
On **My Schedule**, show estimated tuition = total credits × a per-credit rate.

> Prompt idea: *"On the schedule stats row, add a 4th card 'Estimated tuition'
> computed as total credits × $450."*  (Bonus: this surfaces the credits bug below!)

### Option D — "Waitlist a full course" (full stack)
Let students join a waitlist when a course is full; store it in `state.json`.

> Prompt idea: *"Add POST `/api/waitlist` in server.py that records a waitlist entry
> in the store, and a 'Join waitlist' button on full course cards."*

### Feature lab — a bigger menu of student build-ons

Options A–D above are full walk-throughs; this is a quick-pick menu for attendees to
choose from. Each names the file/function it touches so students can dive straight in.

**Tier 1 — frontend only (~5–10 min, ideal first Copilot tasks)**
| Feature | Where it lives |
| ------- | -------------- |
| Sort the catalog (by code, credits, or fewest seats) | sort before `renderCatalog()` in `app.js` |
| "Has open seats" toggle (hide full courses) | `applyFilters()` using `course.seatsLeft` |
| Meeting-day filter chips (Mon–Fri) | filter bar + `applyFilters()` using `course.days` |
| ⭐ Favorite courses + "Favorites only" (localStorage) | `courseCardHTML()` (this is Option B) |
| Dark-mode toggle | flip the `:root` CSS variables + `localStorage` |

**Tier 2 — schedule & stats polish**
| Feature | Where it lives |
| ------- | -------------- |
| "Estimated tuition" stat card (credits × rate) | `renderStats()` / the stats row (Option C) |
| Credit-overload warning banner (e.g. > 12 credits) | `renderSchedule()` — pairs nicely with the credits bug |
| Print / export schedule (print CSS or `.ics` download) | new button + a print stylesheet |

**Tier 3 — full-stack / backend (pair with "now write a test")**
| Feature | Where it lives |
| ------- | -------------- |
| Waitlist a full course | `POST /api/waitlist` in `server.py` + button (Option D) |
| Course ratings (average ⭐, persisted) | `state.json` + `courseCardHTML()` / `openModal()` |
| Enforce a max credit load | rule in `evaluate_booking()` **+ a unit test** |
| Course prerequisites | `prerequisites` field + check in `evaluate_booking()` **+ a test** |

> 💡 Tier 1 items are "describe it and let Copilot wire it up." For Tier 3, follow up with
> *"now add a unittest for this"* so students watch Copilot generate a test, then run
> `python -m unittest discover -s tests`.

---

## 2. Demo: detect & fix bugs 🐞

There are **four** planted bugs — two in the backend (caught by failing tests) and
two in the frontend (visible in the browser). None of them crash the app; they
produce subtly wrong behaviour, which makes them great Copilot exercises.

### 🔴 Bug 1 — Time conflicts aren't detected (backend)
* **Symptom:** You can enroll in two classes that overlap. On **My Schedule** the
  calendar blocks visibly overlap. Reproduce: enroll in **CS 501** (Mon/Wed
  9:00–10:30) *and* **ENGR 525** (Mon/Wed 9:30–11:00) — both are accepted.
* **Where:** `server.py` → `courses_conflict()`.
* **The bug:** it only flags an *identical* start time:
  ```python
  return course_a["startTime"] == course_b["startTime"]
  ```
* **The fix:** compare the actual time ranges using the helpers already provided:
  ```python
  return times_overlap(
      parse_time(course_a["startTime"]), parse_time(course_a["endTime"]),
      parse_time(course_b["startTime"]), parse_time(course_b["endTime"]),
  )
  ```
* **Failing tests:** `test_detects_overlapping_courses_with_different_starts`,
  `test_rejects_booking_with_time_conflict`.

### 🔴 Bug 2 — A full course accepts one extra student (backend, off-by-one)
* **Symptom:** **DS 540 Machine Learning** ships full (28/28) yet still lets you
  enroll, pushing it to 29/28.
* **Where:** `server.py` → `has_open_seat()`.
* **The bug:** wrong comparison operator (`<=` instead of `<`):
  ```python
  return enrolled <= capacity
  ```
* **The fix:**
  ```python
  return enrolled < capacity
  ```
* **Failing tests:** `test_no_open_seat_when_full`,
  `test_rejects_booking_when_course_is_full`, `test_cannot_enroll_in_full_seeded_course`.

### 🟡 Bug 3 — Search is case-sensitive (frontend)
* **Symptom:** Searching `quantum` (lowercase) finds nothing, but `Quantum`
  works. Same for course codes: `cs 501` vs `CS 501`.
* **Where:** `public/js/app.js` → `applyFilters()`.
* **The bug:** the query and fields aren't normalised before `includes()`:
  ```js
  const query = searchInput.value.trim();
  const matchesSearch = !query ||
    course.title.includes(query) || course.code.includes(query) || course.instructor.includes(query);
  ```
* **The fix:** lowercase both sides:
  ```js
  const query = searchInput.value.trim().toLowerCase();
  const matchesSearch = !query ||
    course.title.toLowerCase().includes(query) ||
    course.code.toLowerCase().includes(query) ||
    course.instructor.toLowerCase().includes(query);
  ```

### 🟡 Bug 4 — Total credits are concatenated, not summed (frontend)
* **Symptom:** **My Schedule** shows a nonsense "Total credits" like `03333`
  instead of `12`.
* **Where:** `public/js/app.js` → `updateCreditTotal()`.
* **The bug:** `dataset` values are strings, so `+=` concatenates:
  ```js
  totalCredits += item.dataset.credits;   // "0" + "3" + "3" ...
  ```
* **The fix:** convert to a number first:
  ```js
  totalCredits += Number(item.dataset.credits);
  ```

> 💡 Let Copilot find these: select the function and ask *"Why does the total
> credits show 03333 instead of 12?"* or *"There's a bug here — find and fix it."*

---

## 3. Demo: write & run tests ✅

The suite in `tests/test_server.py` uses only `unittest` (no dependencies).

Suggested flow:
1. Run the suite — show the **5 red** tests and read the failure messages aloud.
2. Use Copilot to fix **Bug 1** and **Bug 2** in `server.py` (see above).
3. Re-run — watch the suite go **green**.
4. Bonus: ask Copilot to *"add a unittest that a student cannot drop a course they
   are not enrolled in"* to show test generation.

```bash
python -m unittest discover -s tests -v
```

---

## 📋 Planted-bug cheat sheet

| # | Layer    | File                | Function            | Fix in one line                              |
| - | -------- | ------------------- | ------------------- | -------------------------------------------- |
| 1 | Backend  | `server.py`         | `courses_conflict`  | Compare time ranges, not just start times    |
| 2 | Backend  | `server.py`         | `has_open_seat`     | Use `<` instead of `<=`                        |
| 3 | Frontend | `public/js/app.js`  | `applyFilters`      | Lowercase the query and fields                |
| 4 | Frontend | `public/js/app.js`  | `updateCreditTotal` | `Number(item.dataset.credits)`                |

---

## 🗺️ Architecture at a glance

* `server.py` exposes a tiny REST API and serves the static `public/` folder. The
  booking rules live in small **pure functions** (`parse_time`, `times_overlap`,
  `courses_conflict`, `has_open_seat`, `evaluate_booking`) so they're easy to unit
  test and easy to reason about on screen.
* `public/js/app.js` is a framework-free single-page app: it fetches JSON, builds
  DOM, and renders the weekly calendar by absolute-positioning event blocks from
  each course's start/end time.
* State persists to `data/state.json`; sessions are in-memory tokens.

Happy demoing! 🎉
