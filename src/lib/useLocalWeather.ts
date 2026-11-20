import { useEffect, useState } from "react";
import type { CurrentWeather, WeatherCoordinates, WeatherSearchRequest, WeatherSearchResponse } from "../../shared/protocol.ts";
import type { WeatherPreferences } from "./weatherPreferences.ts";

const REFRESH_MS = 15 * 60_000;

export class WeatherRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function weatherRequest<T>(action: "search" | "current", input: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/weather/${action}`, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", "x-herdr-weather": "1" },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new WeatherRequestError(failure?.error?.code ?? "weather_unavailable");
  }
  return response.json() as Promise<T>;
}

export function searchWeatherLocations(input: WeatherSearchRequest, signal: AbortSignal): Promise<WeatherSearchResponse> {
  return weatherRequest("search", input, signal);
}

/** Explicit device lookups and re-use of an existing browser grant are always coarse. */
export function locateWeather(success: (coordinates: WeatherCoordinates) => void, failure: () => void): void {
  if (!window.isSecureContext || !navigator.geolocation) { failure(); return; }
  navigator.geolocation.getCurrentPosition(({ coords }) => success({
    latitude: Math.round(coords.latitude * 10) / 10,
    longitude: Math.round(coords.longitude * 10) / 10,
  }), failure, { enableHighAccuracy: false, maximumAge: REFRESH_MS, timeout: 10_000 });
}

type WeatherReading = { kind: "loading" } | { kind: "ready"; data: CurrentWeather } | { kind: "failed"; code: string };

export function useLocalWeather(
  location: WeatherPreferences["location"],
  device: WeatherCoordinates | null,
  setDevice: (coords: WeatherCoordinates | null) => void,
  active: boolean,
  retry: number,
  resolvePlace: boolean,
):
  WeatherReading | { kind: "off" | "needs-location" } {
  const [reading, setReading] = useState<{ key: string; state: WeatherReading } | null>(null);
  useEffect(() => {
    if (location !== "device" || !active || !navigator.permissions) return;
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const refreshDevice = () => {
      if (permission?.state !== "granted") {
        setDevice(null);
        return;
      }
      locateWeather((coordinates) => { if (!cancelled) setDevice(coordinates); }, () => { if (!cancelled) setDevice(null); });
    };
    const refreshWhenVisible = () => { if (!document.hidden) refreshDevice(); };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_MS);
    void navigator.permissions.query({ name: "geolocation" }).then((result) => {
      if (cancelled) return;
      permission = result;
      result.addEventListener("change", refreshDevice);
      document.addEventListener("visibilitychange", refreshWhenVisible);
      refreshDevice();
    }).catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      permission?.removeEventListener("change", refreshDevice);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [location, active, setDevice]);

  const coordinates = location === "device" ? device : location;
  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;
  const key = coordinates ? `${latitude},${longitude},${resolvePlace}` : null;
  useEffect(() => {
    if (!active || key === null) return;
    const controller = new AbortController();
    let lastRequest = 0;
    const refresh = () => {
      if (document.hidden || Date.now() - lastRequest < REFRESH_MS) return;
      lastRequest = Date.now();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      void weatherRequest<CurrentWeather>("current", { latitude, longitude, ...(resolvePlace && { resolve_place: true }) }, signal).then((data) => {
        if (controller.signal.aborted) return;
        if (!Number.isFinite(data?.temperature) || typeof data.model_time !== "string" ||
            !["clear", "cloudy", "rain", "fog", "snow", "storm"].includes(data.condition)) {
          throw new WeatherRequestError("weather_unavailable");
        }
        setReading({ key, state: { kind: "ready", data } });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error instanceof WeatherRequestError ? error.code : "weather_unavailable";
        setReading({ key, state: { kind: "failed", code } });
      });
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, key, latitude, longitude, retry, resolvePlace]);

  if (!active || !location) return { kind: "off" };
  if (key === null) return { kind: "needs-location" };
  return reading?.key === key ? reading.state : { kind: "loading" };
}
