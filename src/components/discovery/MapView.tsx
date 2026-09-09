"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { Business } from "@/types";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

const selectedIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    iconRetinaUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

interface MapViewProps {
    businesses: Business[];
    onBoundsChange: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
    selectedCenter: { lat: number; lng: number } | null;
    onMapClick: (latlng: { lat: number; lng: number }) => void;
    /** Where the map starts — the picked center if the user restored a session, else a default */
    initialCenter?: { lat: number; lng: number } | null;
}

function BoundsTracker({ onBoundsChange }: { onBoundsChange: MapViewProps["onBoundsChange"] }) {
    const map = useMap();

    useEffect(() => {
        const updateBounds = () => {
            const b = map.getBounds();
            onBoundsChange({
                minLat: b.getSouth(),
                minLng: b.getWest(),
                maxLat: b.getNorth(),
                maxLng: b.getEast(),
            });
        };

        updateBounds();
        map.on("moveend", updateBounds);

        return () => {
            map.off("moveend", updateBounds);
        };
    }, [map, onBoundsChange]);

    return null;
}

function ClickHandler({ onMapClick }: { onMapClick: MapViewProps["onMapClick"] }) {
    useMapEvents({
        click(e) {
            onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
        },
    });
    return null;
}

export default function MapView({ businesses, onBoundsChange, selectedCenter, onMapClick, initialCenter }: MapViewProps) {
    const markers = useMemo(() => businesses.map((business) => (
        business.location?.lat != null && business.location?.lng != null ? (
            <Marker
                key={business.id}
                position={[business.location.lat, business.location.lng]}
            />
        ) : null
    )), [businesses]);

    const startCenter: [number, number] = [
        initialCenter?.lat ?? 40.7128,
        initialCenter?.lng ?? -74.006,
    ];

    return (
        <MapContainer center={startCenter} zoom={12} style={{ height: "100%", width: "100%" }}>
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <BoundsTracker onBoundsChange={onBoundsChange} />
            <ClickHandler onMapClick={onMapClick} />

            {markers}

            {selectedCenter && (
                <Marker
                    position={[selectedCenter.lat, selectedCenter.lng]}
                    icon={selectedIcon}
                />
            )}
        </MapContainer>
    );
}
