// ---------- Element refs ----------
const $ = (id) => document.getElementById(id);
const searchForm = $("searchForm");
const searchInput = $("searchInput");
const suggestionsEl = $("suggestions");
const geoBtn = $("geoBtn");
const unitBtn = $("unitBtn");
const statusEl = $("status");
const contentEl = $("content");

// ---------- State ----------
let unit = localStorage.getItem("unit") || "C"; // "C" or "F"
let place = null;   // { name, country, lat, lon }
let weather = null; // raw API data (always metric)

// ---------- Weather code map (WMO) ----------
function describe(code, isDay = 1) {
  const day = isDay === 1;
  const map = {
    0:  ["Clear sky", day ? "☀️" : "🌙", day ? "clear-day" : "clear-night"],
    1:  ["Mostly clear", day ? "🌤️" : "🌙", day ? "clear-day" : "clear-night"],
    2:  ["Partly cloudy", day ? "⛅" : "☁️", "cloudy"],
    3:  ["Overcast", "☁️", "cloudy"],
    45: ["Foggy", "🌫️", "fog"],
    48: ["Rime fog", "🌫️", "fog"],
    51: ["Light drizzle", "🌦️", "rain"],
    53: ["Drizzle", "🌦️", "rain"],
    55: ["Heavy drizzle", "🌧️", "rain"],
    56: ["Freezing drizzle", "🌧️", "rain"],
    57: ["Freezing drizzle", "🌧️", "rain"],
    61: ["Light rain", "🌦️", "rain"],
    63: ["Rain", "🌧️", "rain"],
    65: ["Heavy rain", "🌧️", "rain"],
    66: ["Freezing rain", "🌧️", "rain"],
    67: ["Freezing rain", "🌧️", "rain"],
    71: ["Light snow", "🌨️", "snow"],
    73: ["Snow", "❄️", "snow"],
    75: ["Heavy snow", "❄️", "snow"],
    77: ["Snow grains", "❄️", "snow"],
    80: ["Rain showers", "🌦️", "rain"],
    81: ["Rain showers", "🌧️", "rain"],
    82: ["Violent showers", "⛈️", "storm"],
    85: ["Snow showers", "🌨️", "snow"],
    86: ["Heavy snow showers", "🌨️", "snow"],
    95: ["Thunderstorm", "⛈️", "storm"],
    96: ["Thunderstorm & hail", "⛈️", "storm"],
    99: ["Severe thunderstorm", "⛈️", "storm"],
  };
  const [label, icon, theme] = map[code] || ["Unknown", "🌡️", "cloudy"];
  return { label, icon, theme };
}

// ---------- Unit helpers ----------
const toTemp = (c) => Math.round(unit === "C" ? c : (c * 9) / 5 + 32);
const toWind = (kmh) => (unit === "C" ? `${Math.round(kmh)} km/h` : `${Math.round(kmh * 0.621371)} mph`);

// ---------- Status helpers ----------
function showLoading(msg = "Fetching the skies...") {
  statusEl.className = "status";
  statusEl.innerHTML = `<div class="spinner"></div><p>${msg}</p>`;
  contentEl.classList.add("hidden");
}
function showError(msg) {
  statusEl.className = "status error";
  statusEl.innerHTML = `<p>😕 ${msg}</p>`;
  contentEl.classList.add("hidden");
}
function hideStatus() {
  statusEl.className = "status hidden";
}

// ---------- API calls ----------
async function searchCities(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  return data.results || [];
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,pressure_msl,wind_speed_10m",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: 7,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error("Could not load weather data");
  return res.json();
}

async function reverseName(lat, lon) {
  // Free reverse geocoding (no key needed)
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`);
    const d = await res.json();
    const a = d.address || {};
    return {
      name: a.city || a.town || a.village || a.county || a.state || "Your location",
      country: a.country || "",
    };
  } catch {
    return { name: "Your location", country: "" };
  }
}

// ---------- Load a place ----------
async function loadPlace(p) {
  place = p;
  showLoading();
  try {
    weather = await fetchWeather(p.lat, p.lon);
    localStorage.setItem("lastPlace", JSON.stringify(p));
    render();
  } catch (err) {
    showError(err.message || "Something went wrong. Check your connection.");
  }
}

// ---------- Render ----------
function render() {
  if (!weather || !place) return;
  const c = weather.current;
  const info = describe(c.weather_code, c.is_day);

  document.body.dataset.theme = info.theme;

  $("city").textContent = place.country ? `${place.name}, ${place.country}` : place.name;
  $("date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    timeZone: weather.timezone,
  });
  $("temp").textContent = `${toTemp(c.temperature_2m)}°`;
  $("condition").textContent = info.label;
  $("feels").textContent = `Feels like ${toTemp(c.apparent_temperature)}°${unit}`;
  $("bigIcon").textContent = info.icon;

  $("humidity").textContent = `${c.relative_humidity_2m}%`;
  $("wind").textContent = toWind(c.wind_speed_10m);
  $("pressure").textContent = `${Math.round(c.pressure_msl)} hPa`;

  // Rain chance: use current hour's probability
  const h = weather.hourly;
  const startIdx = Math.max(0, h.time.findIndex((t) => t >= c.time.slice(0, 13) + ":00"));
  $("rain").textContent = `${h.precipitation_probability[startIdx] ?? 0}%`;

  // Hourly (next 24 hours)
  const hourlyEl = $("hourly");
  hourlyEl.innerHTML = "";
  for (let i = startIdx; i < startIdx + 24 && i < h.time.length; i++) {
    const hi = describe(h.weather_code[i], h.is_day[i]);
    const hour = new Date(h.time[i]).toLocaleTimeString([], { hour: "numeric" });
    const div = document.createElement("div");
    div.className = "hour" + (i === startIdx ? " now" : "");
    div.innerHTML = `
      <div class="t">${i === startIdx ? "Now" : hour}</div>
      <div class="i">${hi.icon}</div>
      <div class="v">${toTemp(h.temperature_2m[i])}°</div>`;
    hourlyEl.appendChild(div);
  }

  // Daily
  const d = weather.daily;
  const dailyEl = $("daily");
  dailyEl.innerHTML = "";
  d.time.forEach((t, i) => {
    const di = describe(d.weather_code[i], 1);
    const name = i === 0 ? "Today" : new Date(t + "T12:00").toLocaleDateString(undefined, { weekday: "long" });
    const li = document.createElement("li");
    li.className = "day";
    li.innerHTML = `
      <span class="name">${name}</span>
      <span class="icon">${di.icon}</span>
      <span class="desc">${di.label} · ${d.precipitation_probability_max[i] ?? 0}% rain</span>
      <span class="range">${toTemp(d.temperature_2m_max[i])}°<span class="lo">${toTemp(d.temperature_2m_min[i])}°</span></span>`;
    dailyEl.appendChild(li);
  });

  hideStatus();
  contentEl.classList.remove("hidden");
  // replay entrance animation
  contentEl.style.animation = "none";
  void contentEl.offsetWidth;
  contentEl.style.animation = "";
}

// ---------- Search + suggestions ----------
let debounce;
searchInput.addEventListener("input", () => {
  clearTimeout(debounce);
  const q = searchInput.value.trim();
  if (q.length < 2) return hideSuggestions();
  debounce = setTimeout(async () => {
    try {
      const results = await searchCities(q);
      showSuggestions(results);
    } catch {
      hideSuggestions();
    }
  }, 300);
});

function showSuggestions(results) {
  if (!results.length) return hideSuggestions();
  suggestionsEl.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    const region = [r.admin1, r.country].filter(Boolean).join(", ");
    li.innerHTML = `${r.name}<small>${region}</small>`;
    li.addEventListener("click", () => {
      pick({ name: r.name, country: r.country || "", lat: r.latitude, lon: r.longitude });
    });
    suggestionsEl.appendChild(li);
  });
  suggestionsEl.classList.remove("hidden");
}
function hideSuggestions() {
  suggestionsEl.classList.add("hidden");
  suggestionsEl.innerHTML = "";
}
function pick(p) {
  hideSuggestions();
  searchInput.value = "";
  loadPlace(p);
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  hideSuggestions();
  showLoading("Searching...");
  try {
    const results = await searchCities(q);
    if (!results.length) return showError(`No city found for "${q}". Try another spelling.`);
    const r = results[0];
    pick({ name: r.name, country: r.country || "", lat: r.latitude, lon: r.longitude });
  } catch {
    showError("Search failed. Check your internet connection.");
  }
});

document.addEventListener("click", (e) => {
  if (!searchForm.contains(e.target)) hideSuggestions();
});

// ---------- Geolocation ----------
geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return showError("Geolocation isn't supported in this browser.");
  showLoading("Finding your location...");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const { name, country } = await reverseName(lat, lon);
      loadPlace({ name, country, lat, lon });
    },
    () => showError("Couldn't get your location. Allow location access or search for a city."),
    { timeout: 10000 }
  );
});

// ---------- Unit toggle ----------
function updateUnitBtn() {
  unitBtn.textContent = `°${unit}`;
}
unitBtn.addEventListener("click", () => {
  unit = unit === "C" ? "F" : "C";
  localStorage.setItem("unit", unit);
  updateUnitBtn();
  render();
});

// ---------- Init ----------
updateUnitBtn();
(function init() {
  let start = { name: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792 };
  try {
    const saved = JSON.parse(localStorage.getItem("lastPlace"));
    if (saved && saved.lat != null) start = saved;
  } catch {}
  loadPlace(start);
})();
