/* ===================================================================
   app.js — CSTU Class Booking front-end controller
   Plain browser JavaScript (no framework, no build step).
   =================================================================== */

/* ---------- Constants ---------- */
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_LABELS = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

const DEPT_COLORS = {
  "Computer Science": "#851719",
  "Data Science": "#1f5066",
  Mathematics: "#7a2e57",
  Physics: "#3c3b6e",
  Biology: "#2f6b3f",
  Chemistry: "#b5641e",
  Engineering: "#345b76",
  Business: "#8a6d1f",
};

const CAL_START_MIN = 8 * 60;   // 8:00 AM
const CAL_END_MIN = 19 * 60;    // 7:00 PM
const PX_PER_MIN = 54 / 60;     // each hour slot is 54px tall

const ICONS = {
  instructor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/></svg>',
};

/* ---------- App state ---------- */
const state = {
  user: null,
  courses: [],
  bookingIds: new Set(),
  view: "catalog",
};

/* ---------- DOM references ---------- */
const $ = (id) => document.getElementById(id);
const loginScreen = $("login-screen");
const appShell = $("app-shell");
const loginForm = $("login-form");
const loginError = $("login-error");
const searchInput = $("search-input");
const departmentFilter = $("department-filter");
const typeFilter = $("type-filter");
const catalogGrid = $("catalog-grid");
const catalogEmpty = $("catalog-empty");
const scheduleListEl = $("schedule-list");

/* =================================================================
   Initialisation
   ================================================================= */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  loginForm.addEventListener("submit", handleLogin);
  $("logout-btn").addEventListener("click", handleLogout);

  searchInput.addEventListener("input", applyFilters);
  departmentFilter.addEventListener("change", applyFilters);
  typeFilter.addEventListener("change", applyFilters);

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.body.addEventListener("click", (event) => {
    const goto = event.target.closest("[data-goto]");
    if (goto) switchView(goto.dataset.goto);
  });

  $("modal-close").addEventListener("click", closeModal);
  $("modal-backdrop").addEventListener("click", (event) => {
    if (event.target === $("modal-backdrop")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  if (API.token) {
    try {
      const data = await API.session();
      state.user = data.user;
      await enterApp();
      return;
    } catch (err) {
      API.setToken(null);
    }
  }
  showLogin();
}

/* =================================================================
   Authentication
   ================================================================= */
async function handleLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  const username = $("login-username").value.trim();
  const password = $("login-password").value;
  const submitBtn = $("login-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  try {
    const data = await API.login(username, password);
    API.setToken(data.token);
    state.user = data.user;
    await enterApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
  }
}

async function handleLogout() {
  try {
    await API.logout();
  } catch (err) {
    /* ignore network errors on logout */
  }
  API.setToken(null);
  state.user = null;
  state.courses = [];
  state.bookingIds = new Set();
  showLogin();
}

function showLogin() {
  appShell.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
}

async function enterApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  renderUser();
  // Load bookings before courses so the catalog's first paint already knows
  // which courses the student is enrolled in.
  await loadBookings();
  await loadCourses();
  switchView("catalog");
}

function renderUser() {
  const user = state.user || {};
  $("user-name").textContent = user.name || "Student";
  $("user-major").textContent = (user.major || "") + (user.year ? " · " + user.year : "");
  const initials = (user.name || "S")
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  $("user-avatar").textContent = initials;
}

/* =================================================================
   Data loading
   ================================================================= */
async function loadCourses() {
  const data = await API.getCourses();
  state.courses = data.courses;
  populateDepartmentFilter();
  applyFilters();
}

async function loadBookings() {
  const data = await API.getBookings();
  state.bookingIds = new Set(data.bookings.map((course) => course.id));
}

function populateDepartmentFilter() {
  const departments = Array.from(new Set(state.courses.map((c) => c.department))).sort();
  departmentFilter.innerHTML =
    '<option value="">All departments</option>' +
    departments.map((d) => '<option value="' + escapeHtml(d) + '">' + escapeHtml(d) + "</option>").join("");
}

/* =================================================================
   View switching
   ================================================================= */
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  $("view-catalog").hidden = view !== "catalog";
  $("view-schedule").hidden = view !== "schedule";
  if (view === "schedule") renderSchedule();
}

/* =================================================================
   Catalog
   ================================================================= */
function applyFilters() {
  const query = searchInput.value.trim();
  const department = departmentFilter.value;
  const type = typeFilter.value;

  const filtered = state.courses.filter((course) => {
    const matchesSearch =
      !query ||
      course.title.includes(query) ||
      course.code.includes(query) ||
      course.instructor.includes(query);
    const matchesDepartment = !department || course.department === department;
    const matchesType = !type || course.type === type;
    return matchesSearch && matchesDepartment && matchesType;
  });

  renderCatalog(filtered);
}

function renderCatalog(courses) {
  $("catalog-count").textContent = state.courses.length;
  catalogEmpty.hidden = courses.length !== 0;
  catalogGrid.innerHTML = courses.map(courseCardHTML).join("");

  catalogGrid.querySelectorAll("[data-enroll]").forEach((btn) => {
    btn.addEventListener("click", () => toggleEnrollment(btn.dataset.enroll));
  });
  catalogGrid.querySelectorAll("[data-details]").forEach((el) => {
    el.addEventListener("click", () => openModal(el.dataset.details));
  });
}

function courseCardHTML(course) {
  const color = deptColor(course.department);
  const enrolled = state.bookingIds.has(course.id);
  const ratio = course.capacity ? course.enrolled / course.capacity : 0;
  const fillClass = course.seatsLeft === 0 ? "full" : ratio >= 0.85 ? "warn" : "";
  const isFull = course.seatsLeft === 0 && !enrolled;

  let buttonHTML;
  if (enrolled) {
    buttonHTML = '<button class="btn-enroll drop" data-enroll="' + course.id + '">Drop course</button>';
  } else if (isFull) {
    buttonHTML = '<button class="btn-enroll" disabled>Course full</button>';
  } else {
    buttonHTML = '<button class="btn-enroll" data-enroll="' + course.id + '">Add to schedule</button>';
  }

  return (
    '<article class="course-card ' + (enrolled ? "enrolled " : "") + (isFull ? "full" : "") + '" style="--dept:' + color + '">' +
      '<div class="card-head">' +
        '<span class="course-code">' + escapeHtml(course.code) + "</span>" +
        '<span class="credits-badge">' + course.credits + " credits</span>" +
      "</div>" +
      '<h3 class="course-title" data-details="' + course.id + '">' + escapeHtml(course.title) + "</h3>" +
      '<p class="course-instructor">' + escapeHtml(course.instructor) + "</p>" +
      '<div class="course-meta">' +
        metaItem("calendar", formatDays(course.days)) +
        metaItem("clock", formatTime(course.startTime) + " – " + formatTime(course.endTime)) +
      "</div>" +
      '<div class="course-meta">' +
        metaItem("location", course.location) +
        metaItem("building", course.department) +
      "</div>" +
      '<div class="seats">' +
        '<div class="seats-bar"><div class="seats-fill ' + fillClass + '" style="width:' + Math.min(ratio * 100, 100) + '%"></div></div>' +
        '<span class="seats-text">' + course.enrolled + " / " + course.capacity + " enrolled · " + course.seatsLeft + " seats left</span>" +
      "</div>" +
      '<div class="card-actions">' + buttonHTML + "</div>" +
    "</article>"
  );
}

function metaItem(icon, text) {
  return '<span class="meta-item">' + ICONS[icon] + "<span>" + escapeHtml(text) + "</span></span>";
}

/* =================================================================
   Enroll / drop
   ================================================================= */
async function toggleEnrollment(courseId) {
  const enrolled = state.bookingIds.has(courseId);
  const course = state.courses.find((c) => c.id === courseId);
  try {
    if (enrolled) {
      await API.drop(courseId);
      state.bookingIds.delete(courseId);
      showToast("Dropped " + (course ? course.code : "course") + ".", "success");
    } else {
      await API.book(courseId);
      state.bookingIds.add(courseId);
      showToast("Added " + (course ? course.code : "course") + " to your schedule.", "success");
    }
    await loadCourses();
    if (state.view === "schedule") renderSchedule();
  } catch (err) {
    showToast(err.message, "error");
  }
}

/* =================================================================
   Schedule view + weekly calendar
   ================================================================= */
function enrolledCourses() {
  return state.courses.filter((course) => state.bookingIds.has(course.id));
}

function renderSchedule() {
  const courses = enrolledCourses();
  const hasCourses = courses.length > 0;
  $("schedule-empty").hidden = hasCourses;
  $("schedule-content").hidden = !hasCourses;

  renderStats(courses);
  if (!hasCourses) return;

  renderCalendar(courses);
  renderScheduleList(courses);
  updateCreditTotal();
}

function renderScheduleList(courses) {
  const sorted = courses.slice().sort((a, b) => a.code.localeCompare(b.code));
  scheduleListEl.innerHTML = sorted
    .map((course) => {
      const color = deptColor(course.department);
      return (
        '<div class="sched-item" data-credits="' + course.credits + '" style="--dept:' + color + '">' +
          '<div class="si-main">' +
            '<span class="si-code">' + escapeHtml(course.code) + "</span>" +
            '<div class="si-title">' + escapeHtml(course.title) + "</div>" +
            '<div class="si-meta">' + formatDays(course.days) + " · " +
              formatTime(course.startTime) + "–" + formatTime(course.endTime) + " · " +
              escapeHtml(course.location) + "</div>" +
          "</div>" +
          '<span class="si-credits">' + course.credits + " cr</span>" +
        "</div>"
      );
    })
    .join("");
}

function renderStats(courses) {
  $("stat-courses").textContent = courses.length;
  $("stat-hours").textContent = weeklyHours(courses);
  // Total credits are computed from the rendered list in updateCreditTotal().
  if (courses.length === 0) $("stat-credits").textContent = "0";
}

function updateCreditTotal() {
  let totalCredits = 0;
  scheduleListEl.querySelectorAll(".sched-item").forEach((item) => {
    totalCredits += item.dataset.credits;
  });
  $("stat-credits").textContent = totalCredits;
}

function weeklyHours(courses) {
  let minutes = 0;
  courses.forEach((course) => {
    const span = parseMinutes(course.endTime) - parseMinutes(course.startTime);
    minutes += span * course.days.length;
  });
  return Math.round((minutes / 60) * 10) / 10;
}

function renderCalendar(courses) {
  const calendar = $("calendar");
  calendar.innerHTML = "";

  calendar.appendChild(el("div", "cal-corner"));
  DAY_ORDER.forEach((day) => {
    calendar.appendChild(el("div", "cal-day-head", day));
  });

  const times = el("div", "cal-times");
  for (let minute = CAL_START_MIN; minute < CAL_END_MIN; minute += 60) {
    times.appendChild(el("div", "cal-time-label", formatTime(minutesToTime(minute))));
  }
  calendar.appendChild(times);

  DAY_ORDER.forEach((day) => {
    const column = el("div", "cal-col");
    for (let minute = CAL_START_MIN; minute < CAL_END_MIN; minute += 60) {
      column.appendChild(el("div", "cal-slot"));
    }
    courses
      .filter((course) => course.days.includes(day))
      .forEach((course) => column.appendChild(calendarEvent(course)));
    calendar.appendChild(column);
  });
}

function calendarEvent(course) {
  const start = parseMinutes(course.startTime);
  const end = parseMinutes(course.endTime);
  const top = (start - CAL_START_MIN) * PX_PER_MIN;
  const height = (end - start) * PX_PER_MIN - 2;

  const event = el("div", "cal-event");
  event.style.top = top + "px";
  event.style.height = height + "px";
  event.style.setProperty("--dept", deptColor(course.department));
  event.innerHTML =
    '<div class="ev-code">' + escapeHtml(course.code) + "</div>" +
    '<div class="ev-title">' + escapeHtml(course.title) + "</div>" +
    '<div class="ev-loc">' + escapeHtml(course.location) + "</div>";
  event.addEventListener("click", () => openModal(course.id));
  return event;
}

/* =================================================================
   Course details modal
   ================================================================= */
function openModal(courseId) {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return;
  const color = deptColor(course.department);
  const enrolled = state.bookingIds.has(course.id);
  const isFull = course.seatsLeft === 0 && !enrolled;

  let actionBtn;
  if (enrolled) {
    actionBtn = '<button class="btn-enroll drop" data-modal-enroll="' + course.id + '">Drop course</button>';
  } else if (isFull) {
    actionBtn = '<button class="btn-enroll" disabled>Course full</button>';
  } else {
    actionBtn = '<button class="btn-enroll" data-modal-enroll="' + course.id + '">Add to schedule</button>';
  }

  $("modal-body").innerHTML =
    '<span class="modal-code" style="--dept:' + color + '">' + escapeHtml(course.code) + " · " + escapeHtml(course.type) + "</span>" +
    "<h3>" + escapeHtml(course.title) + "</h3>" +
    '<p class="modal-instructor">' + escapeHtml(course.instructor) + "</p>" +
    '<p class="modal-desc">' + escapeHtml(course.description) + "</p>" +
    '<div class="modal-grid">' +
      modalField("Schedule", formatDays(course.days)) +
      modalField("Time", formatTime(course.startTime) + " – " + formatTime(course.endTime)) +
      modalField("Location", course.location) +
      modalField("Credits", course.credits + " credits") +
      modalField("Department", course.department) +
      modalField("Availability", course.seatsLeft + " of " + course.capacity + " seats open") +
    "</div>" +
    '<div class="card-actions" style="--dept:' + color + '">' + actionBtn + "</div>";

  const enrollBtn = $("modal-body").querySelector("[data-modal-enroll]");
  if (enrollBtn) {
    enrollBtn.addEventListener("click", async () => {
      await toggleEnrollment(enrollBtn.dataset.modalEnroll);
      closeModal();
    });
  }
  $("modal-backdrop").hidden = false;
}

function modalField(label, value) {
  return (
    '<div><div class="mg-label">' + escapeHtml(label) + '</div><div class="mg-value">' + escapeHtml(value) + "</div></div>"
  );
}

function closeModal() {
  $("modal-backdrop").hidden = true;
}

/* =================================================================
   Toasts
   ================================================================= */
function showToast(message, type) {
  const toast = document.createElement("div");
  toast.className = "toast " + (type || "");
  const icon = type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  toast.innerHTML = '<span class="toast-icon">' + icon + '</span><span>' + escapeHtml(message) + "</span>";
  $("toast-container").appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

/* =================================================================
   Helpers
   ================================================================= */
function deptColor(department) {
  return DEPT_COLORS[department] || "#851719";
}

function parseMinutes(value) {
  const parts = value.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

function formatTime(value) {
  const [hourStr, minuteStr] = value.split(":");
  let hour = parseInt(hourStr, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return hour + ":" + minuteStr + " " + suffix;
}

function formatDays(days) {
  return days.slice().sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).join(", ");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
