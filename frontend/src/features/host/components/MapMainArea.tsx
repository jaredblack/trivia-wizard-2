import { useCallback, useRef, useEffect } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import type { MapMouseEvent } from "@vis.gl/react-google-maps";
import AnswerList from "./AnswerList";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";
import type { Question, TeamData, ScoreData, MapConfig } from "../../../types";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = "trivia-host-map";

interface MapMainAreaProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  mapConfig: MapConfig;
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
  onSetCorrectLocation: (location: [number, number] | null) => void;
  onMapConfigChange: (config: MapConfig) => void;
}

function PlacesSearchInput({
  onPlaceSelected,
}: {
  onPlaceSelected: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onPlaceSelected);
  callbackRef.current = onPlaceSelected;
  const places = useMapsLibrary("places");

  useEffect(() => {
    if (!places || !containerRef.current) return;

    const el = new places.PlaceAutocompleteElement({});
    el.style.width = "200px";
    el.style.colorScheme = "light";
    containerRef.current.appendChild(el);

    const handler = async (e: Event) => {
      const selectEvent = e as unknown as { placePrediction?: google.maps.places.PlacePrediction };
      const prediction = selectEvent.placePrediction;
      if (!prediction) return;

      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["location"] });
      const loc = place.location;
      if (loc) {
        callbackRef.current(loc.lat(), loc.lng());
      }
    };

    el.addEventListener("gmp-select", handler);

    return () => {
      el.removeEventListener("gmp-select", handler);
      el.remove();
    };
  }, [places]);

  return <div ref={containerRef} />;
}

function MapContent({
  question,
  questionNumber,
  teams,
  mapConfig,
  onScoreAnswer,
  onSetCorrectLocation,
  onMapConfigChange,
}: MapMainAreaProps) {
  const map = useMap(MAP_ID);
  const correctLocation = question.mapCorrectLocation ?? null;

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      const latLng = e.detail.latLng;
      if (latLng) {
        onSetCorrectLocation([latLng.lat, latLng.lng]);
      }
    },
    [onSetCorrectLocation],
  );

  const handlePlaceSelected = useCallback(
    (lat: number, lng: number) => {
      onSetCorrectLocation([lat, lng]);
      if (map) {
        map.panTo({ lat, lng });
        map.setZoom(12);
      }
    },
    [onSetCorrectLocation, map],
  );

  // Collect team answer pins for display on the map
  const teamPins = question.answers
    .filter((a) => a.content?.type === "coordinates")
    .map((a) => {
      const content = a.content as { type: "coordinates"; lat: number; lng: number };
      const team = teams.find((t) => t.teamName === a.teamName);
      return {
        teamName: a.teamName,
        lat: content.lat,
        lng: content.lng,
        color: team?.teamColor.hexCode ?? "#666666",
      };
    });

  return (
    <div className="flex flex-col h-full">
      {/* Config bar */}
      <div className="flex flex-wrap items-center gap-4 p-4 m-4 rounded-2xl bg-gray-100">
        {/* Search with autocomplete */}
        <PlacesSearchInput onPlaceSelected={handlePlaceSelected} />

        {correctLocation && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {correctLocation[0].toFixed(4)}, {correctLocation[1].toFixed(4)}
            </span>
            <button
              onClick={() => onSetCorrectLocation(null)}
              className="text-xs text-gray-500 hover:text-gray-700 underline cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Full points distance */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">
            Full pts (km)
          </label>
          <AutoSubmitNumericInput
            value={mapConfig.fullPointsDistanceKm}
            onSubmit={(v) =>
              onMapConfigChange({ ...mapConfig, fullPointsDistanceKm: Math.max(0, v) })
            }
            step="any"
            min={0}
            className="w-20 px-2 py-1 border bg-white border-gray-300 hover:border-gray-400 rounded-xl text-center"
          />
        </div>

        {/* One point distance */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">
            1 pt (km)
          </label>
          <AutoSubmitNumericInput
            value={mapConfig.onePointDistanceKm}
            onSubmit={(v) =>
              onMapConfigChange({ ...mapConfig, onePointDistanceKm: Math.max(1, v) })
            }
            step="any"
            min={1}
            className="w-24 px-2 py-1 border bg-white border-gray-300 hover:border-gray-400 rounded-xl text-center"
          />
        </div>
      </div>

      {/* Map */}
      <div className="mx-4 rounded-lg overflow-hidden border border-gray-300" style={{ height: 300 }}>
        <Map
          id={MAP_ID}
          defaultCenter={{ lat: 20, lng: 0 }}
          defaultZoom={2}
          mapId={MAP_ID}
          gestureHandling="greedy"
          disableDefaultUI={true}
          zoomControl={true}
          onClick={handleMapClick}
          className="w-full h-full"
        >
          {/* Correct location marker */}
          {correctLocation && (
            <AdvancedMarker position={{ lat: correctLocation[0], lng: correctLocation[1] }}>
              <Pin background="#FFD700" borderColor="#B8860B" glyphColor="#B8860B" />
            </AdvancedMarker>
          )}

          {/* Team answer markers */}
          {teamPins.map((tp) => (
            <AdvancedMarker
              key={tp.teamName}
              position={{ lat: tp.lat, lng: tp.lng }}
              title={tp.teamName}
            >
              <Pin background={tp.color} borderColor={tp.color} glyphColor="white" />
            </AdvancedMarker>
          ))}
        </Map>
      </div>

      {/* Answer list */}
      <div className="flex-1 overflow-y-auto">
        <AnswerList
          question={question}
          questionNumber={questionNumber}
          teams={teams}
          onScoreAnswer={onScoreAnswer}
        />
      </div>
    </div>
  );
}

export default function MapMainArea(props: MapMainAreaProps) {
  return (
    <APIProvider apiKey={API_KEY} libraries={["places"]}>
      <MapContent {...props} />
    </APIProvider>
  );
}
