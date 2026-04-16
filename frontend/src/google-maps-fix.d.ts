// PlaceAutocompleteElement is defined in @types/google.maps but missing from the
// PlacesLibrary interface. This patches it until the upstream types are fixed.
// See: https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/68943
declare namespace google.maps {
  interface PlacesLibrary {
    PlaceAutocompleteElement: typeof google.maps.places.PlaceAutocompleteElement;
  }
}
