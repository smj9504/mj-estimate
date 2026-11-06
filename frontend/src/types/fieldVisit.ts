import type { OwnerInfo } from './client';

export type FloorKey = 'B' | '1' | '2' | '3' | 'A';
export type ShotKind = 'wall' | 'demo' | 'video';
export type NameSource = 'default' | 'ai' | 'user';
export type FloorSource = 'default' | 'altitude' | 'ai' | 'user';

/** short is what the floor buttons and the camera's room badge say: words, so nobody has to guess what B or A means */
export const FLOORS: { key: FloorKey; label: string; short: string }[] = [
  { key: 'B', label: 'Basement', short: 'Basement' },
  { key: '1', label: '1st floor', short: '1st' },
  { key: '2', label: '2nd floor', short: '2nd' },
  { key: '3', label: '3rd floor', short: '3rd' },
  { key: 'A', label: 'Attic', short: 'Attic' },
];

export const floorLabel = (floor: string) => FLOORS.find(f => f.key === floor)?.label ?? floor;

/** Keys match ROOM_TITLES in backend/app/domains/field_visit/room_reader.py */
export const ROOM_PRESETS: { key: string; title: string }[] = [
  { key: 'kitchen', title: 'Kitchen' },
  { key: 'bathroom', title: 'Bathroom' },
  { key: 'bedroom', title: 'Bedroom' },
  { key: 'living_room', title: 'Living room' },
  { key: 'dining_room', title: 'Dining room' },
  { key: 'hallway', title: 'Hallway' },
  { key: 'stairs', title: 'Stairs' },
  { key: 'laundry', title: 'Laundry' },
  { key: 'closet', title: 'Closet' },
  { key: 'office', title: 'Office' },
  { key: 'garage', title: 'Garage' },
  { key: 'utility', title: 'Utility' },
  { key: 'basement', title: 'Basement' },
  { key: 'attic', title: 'Attic' },
  { key: 'exterior', title: 'Exterior' },
];

export const roomTitle = (roomType: string) => ROOM_PRESETS.find(p => p.key === roomType)?.title ?? roomType;

export interface FieldAddress {
  street: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface FoundAddress {
  street: string;
  has_number: boolean;
  city: string;
  state: string;
  zipcode: string;
}

export interface ServerRoom {
  id: string;
  name: string;
  name_source: NameSource;
  floor: FloorKey;
  floor_source: FloorSource;
  room_type: string | null;
  position: number;
}

export interface ServerShot {
  id: string;
  room_id: string;
  file_id: string;
  kind: ShotKind;
  wall: number | null;
  captured_at: string | null;
  moved: boolean;
  ai_room_type: string | null;
  is_video: boolean;
  thumbnail_url: string;
  url: string;
}

export interface FieldVisitClient {
  id: string;
  display_name: string;
  owners: OwnerInfo[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  phone?: string | null;
  email?: string | null;
  full_address: string;
}

export interface FieldVisitContract {
  id: string;
  title: string | null;
  contract_number: string | null;
  status: string;
  pdf_url: string;
}

export interface FieldVisitClaim {
  id: string;
  claim_number: string;
  claim_type: string;
  company_id: string | null;
}

export interface FieldVisitDetail {
  id: string;
  claim_id: string | null;
  ground_altitude: number | null;
  started_at: string | null;
  client: FieldVisitClient;
  /** False once the client has gone to a company this person isn't in: the visit stays theirs, the client doesn't */
  client_open?: boolean;
  rooms: ServerRoom[];
  shots: ServerShot[];
  contracts: FieldVisitContract[];
  claims: FieldVisitClaim[];
}

export interface FieldVisitSummary {
  id: string;
  client_id: string;
  client_name: string;
  address: string;
  claim_id: string | null;
  last_activity_at: string | null;
  room_count: number;
  shot_count: number;
  mine: boolean;
}

export interface VisitStarted {
  id: string;
  client_id: string;
  client_created: boolean;
  resumed: boolean;
}

/** What the phone knew when a shot was taken */
export interface ShotReadings {
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  altitude?: number | null;
  altitude_accuracy?: number | null;
  heading?: number | null;
  pitch?: number | null;
  steps?: number | null;
}
