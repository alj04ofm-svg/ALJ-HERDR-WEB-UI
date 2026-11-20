import type { CurrentWeather, WeatherCondition, WeatherCoordinates, WeatherLocation, WeatherSearchResponse } from "../shared/protocol.ts";
import { isJsonObject, jsonResponse } from "./http.ts";
import { sameOrigin } from "./machine-security.ts";

const USER_AGENT = "ALJ-Herdr-Web-UI/1.0 (+https://github.com/alj04ofm-svg/ALJ-HERDR-WEB-UI)";
const THREE_HOURS = 3 * 60 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;
const MAX_FORECASTS = 256;
const MAX_SEARCHES = 128;
const NO_STORE = { "cache-control": "no-store" };

function fail(code: string, message: string, status: number, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message } }, status, { ...NO_STORE, ...headers });
}

async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > 2048) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function roundedCoordinates(latitude: unknown, longitude: unknown): WeatherCoordinates | null {
  if (typeof latitude !== "number" || Math.abs(latitude) > 90 || !Number.isFinite(latitude) ||
      typeof longitude !== "number" || Math.abs(longitude) > 180 || !Number.isFinite(longitude)) return null;
  return { latitude: Math.round(latitude * 10) / 10, longitude: Math.round(longitude * 10) / 10 };
}

function conditionOf(code: string): WeatherCondition {
  if (code.includes("thunder")) return "storm";
  if (code.includes("rain")) return "rain";
  if (code.includes("snow") || code.includes("sleet")) return "snow";
  if (code.includes("fog")) return "fog";
  if (code.startsWith("clearsky") || code.startsWith("fair")) return "clear";
  return "cloudy";
}

function forecastsOf(body: unknown): CurrentWeather[] {
  if (!isJsonObject(body) || !isJsonObject(body.properties) || !Array.isArray(body.properties.timeseries)) return [];
  const results: CurrentWeather[] = [];
  for (const item of body.properties.timeseries.slice(0, 16)) {
    const data = item?.data;
    const temperature = data?.instant?.details?.air_temperature;
    const code = data?.next_1_hours?.summary?.symbol_code ?? data?.next_6_hours?.summary?.symbol_code;
    if (typeof temperature !== "number" || !Number.isFinite(temperature) || typeof code !== "string" ||
        typeof item?.time !== "string" || !Number.isFinite(Date.parse(item.time))) continue;
    results.push({ temperature, condition: conditionOf(code), model_time: item.time });
  }
  return results;
}

function currentForecast(forecasts: CurrentWeather[]): CurrentWeather {
  const now = Date.now();
  return forecasts.reduce((best, item) => Math.abs(Date.parse(item.model_time) - now) < Math.abs(Date.parse(best.model_time) - now) ? item : best);
}

function locationsOf(body: unknown): WeatherLocation[] {
  if (!isJsonObject(body) || !Array.isArray(body.features)) return [];
  const results = new Map<string, WeatherLocation>();
  for (const feature of body.features.slice(0, 8)) {
    const coordinates = feature?.geometry?.coordinates;
    const location = Array.isArray(coordinates) ? roundedCoordinates(coordinates[1], coordinates[0]) : null;
    const properties = feature?.properties;
    if (!location || typeof properties?.name !== "string") continue;
    const label = [...new Set([properties.name, properties.state, properties.country]
      .filter((name): name is string => typeof name === "string" && !!name.trim()))].join(", ").slice(0, 140);
    if (label) results.set(label, { ...location, label });
  }
  return [...results.values()];
}

class ServiceBusy extends Error {}

export class WeatherService {
  private readonly forecasts = new Map<string, { until: number; result: Promise<CurrentWeather[]> }>();
  private readonly searches = new Map<string, { until: number; result: Promise<WeatherLocation[]> }>();
  private readonly places = new Map<string, { until: number; result: Promise<string | undefined> }>();
  private nextPlace = 0;
  private nextForecast = 0;
  private nextSearch = 0;

  private async upstream(url: URL): Promise<Response> {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Weather provider unavailable");
    return response;
  }

  private async forecast(coordinates: WeatherCoordinates): Promise<CurrentWeather> {
    const { latitude, longitude } = coordinates;
    const key = `${latitude},${longitude}`;
    const now = Date.now();
    const saved = this.forecasts.get(key);
    if (saved && saved.until > now) return currentForecast(await saved.result);
    for (const [point, entry] of this.forecasts) if (entry.until <= now) this.forecasts.delete(point);
    if (now < this.nextForecast || this.forecasts.size >= MAX_FORECASTS) throw new ServiceBusy();
    this.nextForecast = now + 1000;
    const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    const entry: { until: number; result: Promise<CurrentWeather[]> } = { until: now + THREE_HOURS, result: this.upstream(url).then(async (response) => {
      const expires = Date.parse(response.headers.get("expires") ?? "");
      if (expires > entry.until) entry.until = expires;
      const forecasts = forecastsOf(await response.json());
      if (forecasts.length === 0) throw new Error("Weather provider returned no estimate");
      return forecasts;
    }).catch((error: unknown) => { this.forecasts.delete(key); throw error; }) };
    this.forecasts.set(key, entry);
    return currentForecast(await entry.result);
  }

  private async search(query: string, language: string): Promise<WeatherSearchResponse> {
    const key = `${language}:${query.toLowerCase()}`;
    const now = Date.now();
    const saved = this.searches.get(key);
    if (saved && saved.until > now) return { locations: await saved.result };
    if (now < this.nextSearch) throw new ServiceBusy();
    this.nextSearch = now + 1000;
    if (this.searches.size >= MAX_SEARCHES) this.searches.delete(this.searches.keys().next().value!);
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("layer", "city");
    if (["en", "de", "fr", "it"].includes(language)) url.searchParams.set("lang", language);
    const result = this.upstream(url).then(async (response) => locationsOf(await response.json()))
      .catch((error: unknown) => { this.searches.delete(key); throw error; });
    this.searches.set(key, { until: now + ONE_DAY, result });
    return { locations: await result };
  }

  private async place(coordinates: WeatherCoordinates): Promise<string | undefined> {
    const key = `${coordinates.latitude},${coordinates.longitude}`;
    const now = Date.now();
    const saved = this.places.get(key);
    if (saved && saved.until > now) return saved.result;
    if (now < this.nextPlace) return;
    this.nextPlace = now + 1000;
    if (this.places.size >= MAX_SEARCHES) this.places.delete(this.places.keys().next().value!);
    const url = new URL("https://photon.komoot.io/reverse");
    url.searchParams.set("lat", String(coordinates.latitude));
    url.searchParams.set("lon", String(coordinates.longitude));
    url.searchParams.set("layer", "city");
    url.searchParams.set("radius", "30");
    url.searchParams.set("limit", "1");
    const entry = { until: now + ONE_DAY, result: this.upstream(url)
      .then(async response => locationsOf(await response.json())[0]?.label)
      .catch(() => { entry.until = now + 300_000; return undefined; }) };
    this.places.set(key, entry);
    return entry.result;
  }

  async handle(request: Request, path: string): Promise<Response> {
    if (request.method !== "POST") return fail("method_not_allowed", "Use POST", 405, { allow: "POST" });
    if (!sameOrigin(request) || request.headers.get("x-herdr-weather") !== "1") {
      return fail("invalid_origin", "Use weather controls from this app", 403);
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return fail("invalid_request", "A JSON weather lookup is required", 400);
    }
    const input = await readInput(request);
    if (!isJsonObject(input)) return fail("invalid_request", "A JSON weather lookup is required", 400);
    try {
      if (path === "/api/weather/search") {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!/^[-\p{L}\p{M}\p{N} .,'’()]{2,100}$/u.test(query)) return fail("invalid_request", "Enter a city or town name", 400);
        const language = typeof input.language === "string" && /^[a-z]{2}$/.test(input.language) ? input.language : "en";
        return jsonResponse(await this.search(query, language), 200, NO_STORE);
      }
      const coordinates = roundedCoordinates(input.latitude, input.longitude);
      if (!coordinates) return fail("invalid_request", "Valid weather coordinates are required", 400);
      const [forecast, place] = await Promise.all([
        this.forecast(coordinates),
        input.resolve_place === true ? this.place(coordinates) : undefined,
      ]);
      return jsonResponse({ ...forecast, ...(place && { place }) }, 200, NO_STORE);
    } catch (error) {
      if (error instanceof ServiceBusy) return fail("weather_busy", "Weather requests are busy. Try again shortly.", 429);
      return fail("weather_unavailable", "Weather provider unavailable", 502);
    }
  }
}
