import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import "./google-project-map.css";

export type GoogleProjectMapPoint = { lat: number; lng: number };
type Point = GoogleProjectMapPoint;
type Mode = "pick" | "satellite";
type LatLng = { lat(): number; lng(): number };
type Listener = { remove(): void };
type MapInstance = {
  addListener(
    event: "click",
    cb: (event: { latLng?: LatLng | null }) => void
  ): Listener;
  getCenter(): LatLng | undefined;
};
type Overlay = {
  onAdd(): void;
  draw(): void;
  onRemove(): void;
  setMap(map: MapInstance | null): void;
  getPanes(): { overlayLayer: Element } | null;
  getProjection():
    | { fromLatLngToDivPixel(point: Point): { x: number; y: number } | null }
    | undefined;
};
type Maps = {
  Map: new (
    element: HTMLElement,
    options: {
      center: Point;
      zoom: number;
      mapTypeId: "roadmap" | "satellite";
      mapTypeControl: boolean;
      streetViewControl: boolean;
      clickableIcons: boolean;
      gestureHandling: "greedy";
    }
  ) => MapInstance;
  OverlayView: new () => Overlay;
};
type MapsWindow = Window & {
  google?: { maps?: Maps };
  gm_authFailure?: () => void;
  pscmGoogleProjectMapsReady?: () => void;
};
type Status = "loading" | "ready" | "error" | "auth";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
const initialCenter = { lat: 24.7136, lng: 46.6753 };
let loadPromise: Promise<Maps> | undefined;
let authenticationFailed = false;
let authHandlerInstalled = false;
const authListeners = new Set<() => void>();

function loadMaps(key: string): Promise<Maps> {
  const browser = window as MapsWindow;
  if (!authHandlerInstalled) {
    authHandlerInstalled = true;
    const previous = browser.gm_authFailure;
    browser.gm_authFailure = () => {
      authenticationFailed = true;
      for (const notify of authListeners) notify();
      previous?.();
    };
  }

  const existing = browser.google?.maps;
  if (existing?.Map && existing.OverlayView) return Promise.resolve(existing);

  loadPromise ??= new Promise<Maps>((resolve, reject) => {
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({
      key,
      callback: "pscmGoogleProjectMapsReady",
      loading: "async",
      v: "quarterly",
    }).toString();
    script.src = url.toString();
    script.async = true;

    function finish(maps?: Maps) {
      window.clearTimeout(timeout);
      delete browser.pscmGoogleProjectMapsReady;
      script.onerror = null;
      if (maps) {
        resolve(maps);
      } else {
        script.remove();
        reject(new Error("Google Maps failed to load"));
      }
    }

    const timeout = window.setTimeout(() => finish(), 20_000);
    browser.pscmGoogleProjectMapsReady = () => {
      const maps = browser.google?.maps;
      finish(maps?.Map && maps.OverlayView ? maps : undefined);
    };
    script.onerror = () => finish();
    document.head.appendChild(script);
  }).catch(error => {
    loadPromise = undefined;
    throw error;
  });

  return loadPromise;
}

function addPin(maps: Maps, map: MapInstance, point: () => Point | null) {
  const overlay = new maps.OverlayView();
  const pin = document.createElement("span");
  pin.className = "pm-google-map-pin";
  pin.setAttribute("aria-hidden", "true");
  pin.hidden = true;
  overlay.onAdd = () => overlay.getPanes()?.overlayLayer.appendChild(pin);
  overlay.draw = () => {
    const current = point();
    const pixel = current
      ? overlay.getProjection()?.fromLatLngToDivPixel(current)
      : null;
    pin.hidden = !pixel;
    if (pixel) {
      pin.style.left = `${pixel.x}px`;
      pin.style.top = `${pixel.y}px`;
    }
  };
  overlay.onRemove = () => pin.remove();
  overlay.setMap(map);
  return overlay;
}

const labels = {
  ar: {
    pick: "خريطة تحديد موقع المشروع",
    satellite: "خريطة موقع المشروع بالقمر الصناعي",
    loading: "جارٍ تحميل خرائط Google…",
    missing: "خرائط Google غير مهيأة لهذا النظام.",
    error: "تعذّر تحميل خرائط Google.",
    auth: "تعذّر الاتصال بخرائط Google بسبب إعدادات الربط.",
    retry: "إعادة المحاولة",
    center: "تحديد مركز الخريطة",
  },
  en: {
    pick: "Map for selecting the project location",
    satellite: "Satellite map of the project location",
    loading: "Loading Google Maps…",
    missing: "Google Maps is not configured for this system.",
    error: "Google Maps could not load.",
    auth: "Google Maps could not connect because of its configuration.",
    retry: "Try again",
    center: "Use the map center",
  },
  ur: {
    pick: "منصوبے کا مقام منتخب کرنے کا نقشہ",
    satellite: "منصوبے کے مقام کا سیٹلائٹ نقشہ",
    loading: "Google Maps لوڈ ہو رہا ہے…",
    missing: "اس سسٹم کے لیے Google Maps کی ترتیبات مکمل نہیں ہیں۔",
    error: "Google Maps لوڈ نہیں ہو سکا۔",
    auth: "ترتیبات کی وجہ سے Google Maps سے رابطہ نہیں ہو سکا۔",
    retry: "دوبارہ کوشش کریں",
    center: "نقشے کے مرکز کو منتخب کریں",
  },
};

export function GoogleProjectMap({
  locale,
  point,
  mode,
  onPick,
}: {
  locale: Locale;
  point: Point | null;
  mode: Mode;
  onPick?: (point: Point) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const pin = useRef<Overlay | null>(null);
  const latestPoint = useRef(point);
  const pick = useRef(onPick);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const copy = labels[locale];

  useEffect(() => {
    latestPoint.current = point;
    pin.current?.draw();
  }, [point]);

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const element = canvas.current;
    if (!apiKey || !element) return;
    if (authenticationFailed) {
      setStatus("auth");
      return;
    }

    let disposed = false;
    let listener: Listener | undefined;
    const onAuthFailure = () => setStatus("auth");
    authListeners.add(onAuthFailure);
    setStatus("loading");

    void loadMaps(apiKey)
      .then(maps => {
        if (disposed || authenticationFailed) return;
        const selected = latestPoint.current;
        const instance = new maps.Map(element, {
          center: selected ?? initialCenter,
          zoom: selected ? 17 : 11,
          mapTypeId: mode === "satellite" ? "satellite" : "roadmap",
          mapTypeControl: mode === "pick",
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        map.current = instance;
        pin.current = addPin(maps, instance, () => latestPoint.current);
        if (mode === "pick") {
          listener = instance.addListener("click", ({ latLng }) => {
            if (latLng)
              pick.current?.({ lat: latLng.lat(), lng: latLng.lng() });
          });
        }
        setStatus(authenticationFailed ? "auth" : "ready");
      })
      .catch(() => {
        if (!disposed) setStatus(authenticationFailed ? "auth" : "error");
      });

    return () => {
      disposed = true;
      authListeners.delete(onAuthFailure);
      listener?.remove();
      pin.current?.setMap(null);
      pin.current = null;
      map.current = null;
      element.replaceChildren();
    };
  }, [mode, attempt]);

  const message = !apiKey
    ? copy.missing
    : status !== "ready"
      ? copy[status]
      : null;
  return (
    <div>
      <div
        className="pm-google-map-frame"
        aria-busy={Boolean(apiKey) && status === "loading"}
      >
        <div
          ref={canvas}
          className="pm-google-map-canvas"
          role="region"
          aria-label={copy[mode]}
          style={{ visibility: message ? "hidden" : "visible" }}
        />
        {message && (
          <div className="pm-google-map-message">
            <span role="status">{message}</span>
            {apiKey && status === "error" && (
              <button
                type="button"
                onClick={() => setAttempt(value => value + 1)}
              >
                {copy.retry}
              </button>
            )}
          </div>
        )}
      </div>
      {mode === "pick" && !message && (
        <div className="pm-google-map-controls">
          <button
            type="button"
            onClick={() => {
              const center = map.current?.getCenter();
              if (center)
                pick.current?.({ lat: center.lat(), lng: center.lng() });
            }}
          >
            {copy.center}
          </button>
        </div>
      )}
    </div>
  );
}
