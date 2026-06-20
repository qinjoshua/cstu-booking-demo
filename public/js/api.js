/* ===================================================================
   api.js — thin wrapper around the CSTU JSON API (fetch based)
   =================================================================== */
const API = {
  token: localStorage.getItem("cstu_token") || null,

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem("cstu_token", token);
    } else {
      localStorage.removeItem("cstu_token");
    }
  },

  async request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) {
      headers["Authorization"] = "Bearer " + this.token;
    }
    const options = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(path, options);
    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    if (!response.ok) {
      const message = (data && data.error) || "Request failed (" + response.status + ")";
      throw new Error(message);
    }
    return data;
  },

  login(username, password) {
    return this.request("POST", "/api/login", { username, password });
  },
  logout() {
    return this.request("POST", "/api/logout");
  },
  session() {
    return this.request("GET", "/api/session");
  },
  getCourses() {
    return this.request("GET", "/api/courses");
  },
  getBookings() {
    return this.request("GET", "/api/bookings");
  },
  book(courseId) {
    return this.request("POST", "/api/bookings", { courseId });
  },
  drop(courseId) {
    return this.request("DELETE", "/api/bookings/" + encodeURIComponent(courseId));
  },
};
