"""Unit tests for the CSTU Class Booking backend.

Run from the project root with either:

    python -m unittest discover -s tests
    python tests/test_server.py

The suite exercises the booking business logic in ``server.py``. A handful of
tests intentionally FAIL against the code as shipped -- they describe the
*correct* behaviour and pin down the bugs planted for the workshop. Use GitHub
Copilot to fix the bugs in ``server.py`` and watch the suite turn green. See
docs/WORKSHOP.md for the full walk-through.

CSTU is a graduate (master's-only) university, so the fixtures use 500/600-level
course codes to match the real catalog in data/courses.json.
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402


def course(cid, code, days, start, end, capacity=40, credits=3):
    return {
        "id": cid,
        "code": code,
        "title": code + " Course",
        "days": days,
        "startTime": start,
        "endTime": end,
        "capacity": capacity,
        "credits": credits,
    }


# Two courses that overlap on shared days but start at different times.
CS501 = course("CS501", "CS 501", ["Mon", "Wed"], "09:00", "10:30")
ENGR525 = course("ENGR525", "ENGR 525", ["Mon", "Wed"], "09:30", "11:00")
# Same start time as CS 501 on a shared day.
LAB = course("LAB", "CS 501L", ["Mon"], "09:00", "10:00")
# No shared meeting day with CS 501.
DS500 = course("DS500", "DS 500", ["Tue", "Thu"], "09:00", "10:30")


class TestTimeHelpers(unittest.TestCase):
    def test_parse_time(self):
        self.assertEqual(server.parse_time("09:30"), 570)
        self.assertEqual(server.parse_time("00:00"), 0)
        self.assertEqual(server.parse_time("18:15"), 1095)

    def test_times_overlap_true(self):
        self.assertTrue(server.times_overlap(540, 630, 570, 660))

    def test_times_overlap_false_when_adjacent(self):
        # 9:00-10:30 then 10:30-12:00 touch but do not overlap.
        self.assertFalse(server.times_overlap(540, 630, 630, 720))


class TestConflictDetection(unittest.TestCase):
    def test_no_conflict_without_shared_day(self):
        self.assertFalse(server.courses_conflict(CS501, DS500))

    def test_conflict_when_start_times_match(self):
        self.assertTrue(server.courses_conflict(CS501, LAB))

    def test_detects_overlapping_courses_with_different_starts(self):
        # CS 501 (09:00-10:30) and ENGR 525 (09:30-11:00) overlap on Mon & Wed.
        # This SHOULD be reported as a conflict. (Planted bug #1.)
        self.assertTrue(server.courses_conflict(CS501, ENGR525))


class TestCapacity(unittest.TestCase):
    def test_open_seat_when_room_remains(self):
        self.assertTrue(server.has_open_seat(20, 40))

    def test_no_open_seat_when_full(self):
        # A class with 28 of 28 seats taken is full. (Planted bug #2.)
        self.assertFalse(server.has_open_seat(28, 28))


class TestEvaluateBooking(unittest.TestCase):
    def setUp(self):
        self.catalog = {c["id"]: c for c in (CS501, ENGR525, DS500)}

    def test_allows_booking_into_open_slot(self):
        ok, error = server.evaluate_booking(self.catalog, [], 5, "CS501")
        self.assertTrue(ok)
        self.assertIsNone(error)

    def test_rejects_unknown_course(self):
        ok, error = server.evaluate_booking(self.catalog, [], 0, "NOPE")
        self.assertFalse(ok)
        self.assertIn("not found", error.lower())

    def test_rejects_duplicate_enrollment(self):
        ok, error = server.evaluate_booking(self.catalog, ["CS501"], 5, "CS501")
        self.assertFalse(ok)
        self.assertIn("already", error.lower())

    def test_rejects_booking_when_course_is_full(self):
        # Capacity is 40 and 40 students are already enrolled. (Planted bug #2.)
        ok, error = server.evaluate_booking(self.catalog, [], 40, "CS501")
        self.assertFalse(ok)
        self.assertIn("full", error.lower())

    def test_rejects_booking_with_time_conflict(self):
        # Already in CS 501, now trying to add overlapping ENGR 525. (Planted bug #1.)
        ok, error = server.evaluate_booking(self.catalog, ["CS501"], 0, "ENGR525")
        self.assertFalse(ok)
        self.assertIn("conflict", error.lower())


class TestStore(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved_state_file = server.STATE_FILE
        server.STATE_FILE = os.path.join(self._tmp.name, "state.json")
        self.store = server.Store()

    def tearDown(self):
        server.STATE_FILE = self._saved_state_file
        self._tmp.cleanup()

    def test_authenticate_seeded_user(self):
        user = self.store.authenticate("alex.chen", "cstu2024")
        self.assertIsNotNone(user)
        self.assertEqual(user["name"], "Alex Chen")

    def test_authenticate_rejects_wrong_password(self):
        self.assertIsNone(self.store.authenticate("alex.chen", "wrong"))

    def test_authenticate_creates_guest_profile(self):
        user = self.store.authenticate("taylor.morgan", "cstu2024")
        self.assertIsNotNone(user)
        self.assertEqual(user["name"], "Taylor Morgan")
        self.assertIn("taylor.morgan", self.store.guests)

    def test_book_and_drop_roundtrip(self):
        ok, error = self.store.book("demo", "PHYS610")
        self.assertTrue(ok, error)
        self.assertIn("PHYS610", [c["id"] for c in self.store.schedule_for("demo")])

        ok, error = self.store.drop("demo", "PHYS610")
        self.assertTrue(ok, error)
        self.assertEqual(self.store.schedule_for("demo"), [])

    def test_cannot_enroll_in_full_seeded_course(self):
        # DS 540 ships full (28 of 28 seats). Enrolling should be rejected.
        # (Planted bug #2 -- demonstrated against real seed data.)
        ok, error = self.store.book("demo", "DS540")
        self.assertFalse(ok)
        self.assertIn("full", (error or "").lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
