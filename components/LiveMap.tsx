import { useRef, useEffect, forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '@/components/ui';
import { COLORS, FONTS, SHADOWS } from '@/constants';
import type { DepartureStatus } from '@/types/database';

export type LiveMember = {
  user_id: string;
  display_name: string;
  index: number;
  lat: number;
  lng: number;
  departure_status: DepartureStatus;
  eta_minutes?: number | null;
};

type Props = {
  destination: { lat: number; lng: number; name?: string } | null;
  members: LiveMember[];
  style?: object;
};

const DOT_COLOR: Record<DepartureStatus, string> = {
  not_left: COLORS.textFaint,
  leaving:  COLORS.warningDeep,
  arrived:  COLORS.successDeep,
};

export const LiveMap = forwardRef<MapboxGL.Camera, Props>(function LiveMap({ destination, members, style }, ref) {
  const cameraRef = useRef<MapboxGL.Camera | null>(null);

  useEffect(() => {
    const coords: [number, number][] = [];
    if (destination) coords.push([destination.lng, destination.lat]);
    for (const m of members) coords.push([m.lng, m.lat]);
    if (coords.length === 0) return;

    const t = setTimeout(() => {
      if (coords.length === 1) {
        cameraRef.current?.flyTo(coords[0], 400);
        return;
      }
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      cameraRef.current?.fitBounds(ne, sw, [80, 60, 100, 60], 400);
    }, 250);
    return () => clearTimeout(t);
  }, [destination?.lat, destination?.lng, members.map(m => `${m.user_id}:${m.lat}:${m.lng}`).join('|')]);

  const center: [number, number] = destination
    ? [destination.lng, destination.lat]
    : [-122.43, 37.78];

  return (
    <MapboxGL.MapView style={[styles.map, style]} logoEnabled={false} attributionEnabled={false}>
      <MapboxGL.Camera
        ref={(r) => {
          cameraRef.current = r;
          if (typeof ref === 'function') ref(r);
          else if (ref) (ref as React.MutableRefObject<MapboxGL.Camera | null>).current = r;
        }}
        centerCoordinate={center}
        zoomLevel={13}
      />

      {destination && (
        <MapboxGL.PointAnnotation
          id="destination"
          coordinate={[destination.lng, destination.lat]}
        >
          <View style={styles.dest}>
            <Feather name="map-pin" size={18} color="#fff" strokeWidth={2.4} />
          </View>
        </MapboxGL.PointAnnotation>
      )}

      {members.map((m) => (
        <MapboxGL.MarkerView key={m.user_id} coordinate={[m.lng, m.lat]}>
          <View style={styles.memberWrap}>
            <Avatar name={m.display_name} index={m.index} size={34} ring />
            <View style={[styles.statusDot, { backgroundColor: DOT_COLOR[m.departure_status] }]} />
            {m.eta_minutes != null && (
              <View style={styles.etaBubble}>
                <Text style={styles.etaText}>{m.eta_minutes}m</Text>
              </View>
            )}
          </View>
        </MapboxGL.MarkerView>
      ))}
    </MapboxGL.MapView>
  );
});

const styles = StyleSheet.create({
  map: { width: '100%', height: 196, borderRadius: 20, overflow: 'hidden' },

  dest: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    ...SHADOWS.floating,
  },

  memberWrap: { alignItems: 'center' },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  etaBubble: {
    marginTop: 3,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
    ...SHADOWS.card,
  },
  etaText: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    includeFontPadding: false,
  },
});
