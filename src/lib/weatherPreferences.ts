import type { WeatherLocation } from "../../shared/protocol.ts";

export interface WeatherPreferences {
  position: "left" | "right";
  size: "small" | "regular" | "large";
  font: "system" | "mono";
  style: "glass" | "sky";
  time: boolean;
  date: boolean;
  temperature: boolean;
  place: boolean;
  unit: "C" | "F";
  matchScene: boolean;
  location: WeatherLocation | "device" | null;
}

export const DEFAULT_WEATHER: WeatherPreferences = {
  position: "right", size: "regular", font: "system", style: "glass",
  time: true, date: true, temperature: true, place: true, unit: "C", matchScene: false, location: null,
};

export function sanitizeWeatherPreferences(value: unknown): WeatherPreferences {
  if (!value || typeof value !== "object") return DEFAULT_WEATHER;
  const source = value as Partial<WeatherPreferences>;
  const location = source.location;
  const savedCity = location && typeof location === "object" &&
    typeof location.label === "string" && location.label.trim() &&
    typeof location.latitude === "number" && Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === "number" && Math.abs(location.longitude) <= 180
    ? { label: location.label.trim().slice(0, 140), latitude: location.latitude, longitude: location.longitude } : null;
  return {
    position: source.position === "left" ? "left" : "right",
    size: source.size === "small" || source.size === "large" ? source.size : "regular",
    font: source.font === "mono" ? "mono" : "system",
    style: source.style === "sky" ? "sky" : DEFAULT_WEATHER.style,
    time: source.time !== false,
    date: source.date !== false,
    temperature: source.temperature !== false,
    place: source.place !== false,
    unit: source.unit === "F" ? "F" : "C",
    matchScene: source.matchScene === true,
    location: location === "device" ? "device" : savedCity,
  };
}
