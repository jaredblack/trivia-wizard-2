import { useState, useCallback } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import type { MapMouseEvent } from "@vis.gl/react-google-maps";
import ColorButton from "../../../components/ui/ColorButton";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
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

  return (
    <div className="flex flex-col gap-3 flex-1">
      <label className="text-base">Place your pin on the map</label>
      <div className="rounded-lg overflow-hidden border border-gray-300" style={{ height: 500 }}>
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
            {pin && (
              <AdvancedMarker position={pin} />
            )}
          </Map>
        </APIProvider>
      </div>
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
