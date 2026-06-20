#!/usr/bin/env python3
"""California Science and Technology University (CSTU) Class Booking - backend.

A self-contained demo server built entirely on the Python standard library.
There are NO third-party dependencies and NO build step: just run

    python server.py

and open http://localhost:8000 in your browser.

The business-logic functions near the top of this file (time parsing, conflict
detection, capacity checks, booking evaluation) are written to be importable by
the test suite in tests/test_server.py without starting the HTTP server.
"""

import json
import mimetypes
import os
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

HOST = "127.0.0.1"
PORT = 8000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_DIR = os.path.join(BASE_DIR, "data")
COURSES_FILE = os.path.join(DATA_DIR, "courses.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
STATE_FILE = os.path.join(DATA_DIR, "state.json")

# Faux authentication: every account shares this password. Any username paired
# with it is allowed to sign in (open enrollment), and the seeded accounts in
# data/users.json get a nicer profile. This is intentionally NOT secure - it is
# a classroom demo, so passwords are stored/compared in plain text.
SHARED_PASSWORD = "cstu2024"

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

_lock = threading.Lock()
_sessions = {}  # session token -> username


# --------------------------------------------------------------------------- #
# Business logic (pure functions - imported directly by the tests)
# --------------------------------------------------------------------------- #

def parse_time(value):
    """Convert a ``"HH:MM"`` string into the number of minutes since midnight."""
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def times_overlap(start_a, end_a, start_b, end_b):
    """Return True if the minute interval [start_a, end_a) overlaps [start_b, end_b)."""
    return start_a < end_b and start_b < end_a


def courses_conflict(course_a, course_b):
    """Return True if two courses meet on a shared day at overlapping times."""
    shared_days = set(course_a["days"]) & set(course_b["days"])
    if not shared_days:
        return False
    return course_a["startTime"] == course_b["startTime"]


def has_open_seat(enrolled, capacity):
    """Return True if a course with ``enrolled`` students still has room."""
    return enrolled <= capacity


def evaluate_booking(courses_by_id, current_booking_ids, enrolled_count, course_id):
    """Decide whether ``course_id`` can be added to a student's schedule.

    Returns a ``(ok, error)`` tuple. ``ok`` is True when the booking is allowed,
    otherwise ``error`` holds a human-readable explanation.

    Parameters
    ----------
    courses_by_id : dict
        Mapping of course id -> course dict.
    current_booking_ids : list
        Course ids the student is already enrolled in.
    enrolled_count : int
        Current enrollment of ``course_id`` (not counting this student).
    course_id : str
        The course the student wants to add.
    """
    if course_id not in courses_by_id:
        return False, "Course not found."

    if course_id in current_booking_ids:
        return False, "You are already enrolled in this course."

    course = courses_by_id[course_id]

    if not has_open_seat(enrolled_count, course["capacity"]):
        return False, "This course is full."

    for booked_id in current_booking_ids:
        booked = courses_by_id.get(booked_id)
        if booked and courses_conflict(course, booked):
            return False, "Time conflict with {} ({}).".format(
                booked["code"], booked["title"]
            )

    return True, None


# --------------------------------------------------------------------------- #
# Data store (seed data + persisted state)
# --------------------------------------------------------------------------- #

def _load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


class Store:
    """Loads seed data and persists student bookings to ``data/state.json``."""

    def __init__(self):
        self.courses = {course["id"]: course for course in _load_json(COURSES_FILE, [])}
        self.users = {user["username"]: user for user in _load_json(USERS_FILE, [])}
        state = _load_json(STATE_FILE, None) or {}
        self.bookings = state.get("bookings", {})  # username -> [course_id, ...]
        self.guests = state.get("guests", {})      # username -> profile dict

    # -- persistence -------------------------------------------------------- #
    def save(self):
        payload = {"bookings": self.bookings, "guests": self.guests}
        tmp_path = STATE_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        os.replace(tmp_path, STATE_FILE)

    # -- accounts ----------------------------------------------------------- #
    def authenticate(self, username, password):
        username = (username or "").strip().lower()
        if not username or password != SHARED_PASSWORD:
            return None
        if username in self.users:
            return self.users[username]
        profile = self.guests.get(username)
        if not profile:
            display = username.replace(".", " ").replace("_", " ").title()
            profile = {
                "username": username,
                "name": display,
                "major": "Graduate Student",
                "year": "First Year",
                "email": "{}@cstu.edu".format(username),
            }
            self.guests[username] = profile
            self.save()
        return profile

    def profile(self, username):
        return self.users.get(username) or self.guests.get(username)

    # -- enrollment --------------------------------------------------------- #
    def enrolled_count(self, course_id):
        course = self.courses.get(course_id)
        base = course.get("seedEnrolled", 0) if course else 0
        live = sum(1 for ids in self.bookings.values() if course_id in ids)
        return base + live

    def public_course(self, course):
        enrolled = self.enrolled_count(course["id"])
        result = {key: value for key, value in course.items() if key != "seedEnrolled"}
        result["enrolled"] = enrolled
        result["seatsLeft"] = max(course["capacity"] - enrolled, 0)
        return result

    def catalog(self):
        return [self.public_course(course) for course in self.courses.values()]

    def schedule_for(self, username):
        booked_ids = self.bookings.get(username, [])
        return [
            self.public_course(self.courses[course_id])
            for course_id in booked_ids
            if course_id in self.courses
        ]

    def book(self, username, course_id):
        with _lock:
            booked = self.bookings.setdefault(username, [])
            enrolled = self.enrolled_count(course_id)
            ok, error = evaluate_booking(self.courses, booked, enrolled, course_id)
            if not ok:
                return False, error
            booked.append(course_id)
            self.save()
            return True, None

    def drop(self, username, course_id):
        with _lock:
            booked = self.bookings.get(username, [])
            if course_id not in booked:
                return False, "You are not enrolled in this course."
            booked.remove(course_id)
            self.save()
            return True, None


_store = None


def get_store():
    global _store
    if _store is None:
        _store = Store()
    return _store


# --------------------------------------------------------------------------- #
# HTTP request handling
# --------------------------------------------------------------------------- #

class CSTUHandler(BaseHTTPRequestHandler):
    server_version = "CSTU/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("  [cstu] {} {}\n".format(self.command, self.path))

    # -- helpers ------------------------------------------------------------ #
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def _current_user(self):
        token = None
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[len("Bearer "):].strip()
        if not token:
            token = self.headers.get("X-Session-Token")
        if token and token in _sessions:
            return _sessions[token]
        return None

    # -- routing ------------------------------------------------------------ #
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._handle_api_get(path)
        else:
            self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            self._handle_login()
        elif path == "/api/logout":
            self._handle_logout()
        elif path == "/api/bookings":
            self._handle_book()
        else:
            self._send_json({"error": "Not found"}, status=404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/bookings/"):
            course_id = unquote(path[len("/api/bookings/"):])
            self._handle_drop(course_id)
        else:
            self._send_json({"error": "Not found"}, status=404)

    # -- API endpoints ------------------------------------------------------ #
    def _handle_api_get(self, path):
        store = get_store()
        if path == "/api/courses":
            self._send_json({"courses": store.catalog()})
            return
        if path == "/api/session":
            username = self._current_user()
            if not username:
                self._send_json({"error": "Not signed in"}, status=401)
                return
            self._send_json({"user": store.profile(username)})
            return
        if path == "/api/bookings":
            username = self._current_user()
            if not username:
                self._send_json({"error": "Not signed in"}, status=401)
                return
            self._send_json({"bookings": store.schedule_for(username)})
            return
        self._send_json({"error": "Not found"}, status=404)

    def _handle_login(self):
        store = get_store()
        data = self._read_json()
        user = store.authenticate(data.get("username"), data.get("password"))
        if not user:
            self._send_json(
                {"error": "Invalid username or password."}, status=401
            )
            return
        token = secrets.token_hex(16)
        _sessions[token] = user["username"]
        self._send_json({"token": token, "user": user})

    def _handle_logout(self):
        token = None
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[len("Bearer "):].strip()
        if not token:
            token = self.headers.get("X-Session-Token")
        if token:
            _sessions.pop(token, None)
        self._send_json({"ok": True})

    def _handle_book(self):
        username = self._current_user()
        if not username:
            self._send_json({"error": "Not signed in"}, status=401)
            return
        store = get_store()
        data = self._read_json()
        course_id = data.get("courseId")
        ok, error = store.book(username, course_id)
        if not ok:
            self._send_json({"error": error}, status=400)
            return
        self._send_json({"ok": True, "bookings": store.schedule_for(username)})

    def _handle_drop(self, course_id):
        username = self._current_user()
        if not username:
            self._send_json({"error": "Not signed in"}, status=401)
            return
        store = get_store()
        ok, error = store.drop(username, course_id)
        if not ok:
            self._send_json({"error": error}, status=400)
            return
        self._send_json({"ok": True, "bookings": store.schedule_for(username)})

    # -- static files ------------------------------------------------------- #
    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        relative = unquote(path.lstrip("/"))
        full_path = os.path.normpath(os.path.join(PUBLIC_DIR, relative))
        if not full_path.startswith(PUBLIC_DIR):
            self._send_json({"error": "Forbidden"}, status=403)
            return
        if not os.path.isfile(full_path):
            # Single-page-app fallback for extension-less routes only.
            if "." not in os.path.basename(full_path):
                full_path = os.path.join(PUBLIC_DIR, "index.html")
            else:
                self._send_json({"error": "Not found"}, status=404)
                return
        content_type, _ = mimetypes.guess_type(full_path)
        content_type = content_type or "application/octet-stream"
        try:
            with open(full_path, "rb") as handle:
                body = handle.read()
        except OSError:
            self._send_json({"error": "Not found"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

def run():
    if sys.version_info < (3, 7):
        sys.exit("CSTU Class Booking requires Python 3.7 or newer.")

    get_store()  # load seed data up front so errors surface immediately
    httpd = ThreadingHTTPServer((HOST, PORT), CSTUHandler)
    url = "http://{}:{}/".format(HOST, PORT)

    banner = "\n".join([
        "",
        "  ===================================================",
        "   California Science and Technology University",
        "   CSTU Class Booking",
        "  ===================================================",
        "",
        "   Server running at  {}".format(url),
        "   Demo login         any name / password 'cstu2024'",
        "   Press Ctrl+C to stop.",
        "",
    ])
    print(banner)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down CSTU Class Booking. Goodbye!")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run()
