# 🎓 CSTU Class Booking

A clean, self-contained class-scheduling web app for the **California Science and Technology University (CSTU)** — built as a hands-on workshop for **Practical Prompt Engineering**.

It is intentionally dependency-free so anyone can run it natively:

* **Frontend** — plain HTML, CSS and JavaScript (no frameworks, no build step, no CDN — works offline).
* **Backend** — Python using only the **standard library** (`http.server`). No `pip install` required.
* **Storage** — a simple JSON file on disk (`data/state.json`), created automatically. No database.

> The only thing you need installed is **Python 3.7+** — which the workshop assumes you already have.

---

## 🚀 Quick start

```bash
# from the project root
python server.py
```

Then open **http://localhost:8000** in your browser.

**Demo sign-in:** use *any* username with the password **`cstu2024`**

Press `Ctrl+C` in the terminal to stop the server.

---

## ✨ Features

* **Faux login** with shared-password open enrollment and seeded student profiles.
* **Course catalog** — 16 graduate courses (500/600-level) across 8 departments,
  rendered as cards with live seat-availability bars and color-coded department stripes.
* **Search & filter** by keyword, department, and course type (Core / Elective / Seminar).
* **Enroll / drop** with server-side **capacity** and **time-conflict** checks.
* **My Schedule** — a visual **weekly calendar grid** plus credit and contact-hour stats.
* **Course details modal**, toast notifications, and a fully responsive layout.

---

## 🧪 Running the tests

The backend logic is covered by a standard-library `unittest` suite:

```bash
python -m unittest discover -s tests        # or:  python tests/test_server.py
```

> **Heads-up:** a few tests **fail on purpose**. They describe the *correct*
> behaviour and pin down the bugs planted for the workshop. Fixing the bugs (with
> Copilot's help!) turns the suite green. See **[docs/WORKSHOP.md](docs/WORKSHOP.md)**.

---

## 📁 Project structure

```
prompt-eng-demo/
├── server.py              # Python stdlib HTTP server + REST API + booking logic
├── data/
│   ├── courses.json       # Seed course catalog
│   ├── users.json         # Seed student accounts
│   └── state.json         # Runtime bookings (auto-generated, git-ignored)
├── public/                # Static frontend served by server.py
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js         # fetch() wrapper for the JSON API
│       └── app.js         # UI rendering and interactions
└── tests/
    └── test_server.py     # unittest suite for the backend
```

---

## 🔌 API reference

| Method & path                 | Auth | Description                              |
| ----------------------------- | ---- | ---------------------------------------- |
| `POST /api/login`             | —    | `{username, password}` → `{token, user}` |
| `POST /api/logout`            | ✓    | Invalidate the session token             |
| `GET  /api/session`           | ✓    | Return the signed-in user                |
| `GET  /api/courses`           | —    | Full catalog with live enrollment counts |
| `GET  /api/bookings`          | ✓    | The signed-in student's courses          |
| `POST /api/bookings`          | ✓    | `{courseId}` → enroll                     |
| `DELETE /api/bookings/{id}`   | ✓    | Drop a course                            |

Authenticated requests send `Authorization: Bearer <token>`.

> ⚠️ **Demo only.** Passwords are compared in plain text and sessions live in
> memory. This app is for teaching, not production.
