import {
  APIProvider,
  AdvancedMarker,
  Map,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";

interface LocationPickerProps {
  apiKey: string;
  value: [number, number] | undefined;
  onPick: (location: [number, number]) => void;
}

/** Click a map to choose the correct spot for a map question. */
export default function LocationPicker({ apiKey, value, onPick }: LocationPickerProps) {
  return (
    <APIProvider apiKey={apiKey}>
      <div style={{ height: 220 }} className="mt-1 rounded overflow-hidden">
        <Map
          defaultCenter={value ? { lat: value[0], lng: value[1] } : { lat: 20, lng: 0 }}
          defaultZoom={value ? 6 : 1}
          mapId="trivia-editor-map"
          gestureHandling="greedy"
          disableDefaultUI={true}
          onClick={(e: MapMouseEvent) => {
            const p = e.detail.latLng;
            if (p) onPick([p.lat, p.lng]);
          }}
        >
          {value && <AdvancedMarker position={{ lat: value[0], lng: value[1] }} />}
        </Map>
      </div>
    </APIProvider>
  );
}
