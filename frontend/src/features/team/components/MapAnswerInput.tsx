import { useState, useCallback } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import type { MapMouseEvent } from "@vis.gl/react-google-maps";
import ColorButton from "../../../components/ui/ColorButton";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
// Bypasses Google Maps to make E2E tests deterministic; see playwright.config.ts.
const TEST_MODE = import.meta.env.VITE_TEST_MODE === "true";
const MAP_ID = "trivia-team-map";

interface MapAnswerInputProps {
  onSubmit: () => void;
  onPinChange: (coords: { lat: number; lng: number } | null) => void;
  teamColor: string;
}

export default function MapAnswerInput({
  onSubmit,
  onPinChange,
  teamColor,
}: MapAnswerInputProps) {
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      const latLng = e.detail.latLng;
      if (latLng) {
        const coords = { lat: latLng.lat, lng: latLng.lng };
        setPin(coords);
        onPinChange(coords);
      }
    },
    [onPinChange],
  );

  const handlePlacePin = () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const coords = { lat, lng };
      setPin(coords);
      onPinChange(coords);
    }
  };

  return (
    <div className="flex flex-col gap-3 flex-1">
      <label className="text-base">Place your pin on the map</label>
      {TEST_MODE ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600">Lat</label>
          <input
            aria-label="Team pin lat"
            value={latInput}
            onChange={(e) => setLatInput(e.target.value)}
            className="w-24 px-2 py-1 border bg-white border-gray-300 rounded-xl text-center"
          />
          <label className="text-sm text-gray-600">Lng</label>
          <input
            aria-label="Team pin lng"
            value={lngInput}
            onChange={(e) => setLngInput(e.target.value)}
            className="w-24 px-2 py-1 border bg-white border-gray-300 rounded-xl text-center"
          />
          <button
            aria-label="Place pin"
            onClick={handlePlacePin}
            className="px-3 py-1 bg-blue-500 text-white rounded-xl cursor-pointer"
          >
            Place pin
          </button>
        </div>
      ) : (
        <div
          className="rounded-lg overflow-hidden border border-gray-300"
          style={{ height: 500 }}
        >
          <APIProvider apiKey={API_KEY}>
            <Map
              defaultCenter={{ lat: 20, lng: 0 }}
              defaultZoom={2}
              mapId={MAP_ID}
              gestureHandling="greedy"
              disableDefaultUI={true}
              zoomControl={true}
              onClick={handleMapClick}
              className="w-full h-full"
            >
              {pin && <AdvancedMarker position={pin} />}
            </Map>
          </APIProvider>
        </div>
      )}
      {pin && (
        <p className="text-sm text-gray-500 text-center">
          {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
        </p>
      )}
      <ColorButton
        onClick={onSubmit}
        disabled={!pin}
        backgroundColor={teamColor}
        className="w-full py-3 rounded-lg"
      >
        Submit Location
      </ColorButton>
    </div>
  );
}
