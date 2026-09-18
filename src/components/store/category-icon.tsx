import {
  BookOpen,
  Camera,
  ChatCircle,
  CheckSquare,
  CloudSun,
  Code,
  FilmStrip,
  FolderOpen,
  GameController,
  GraduationCap,
  Heartbeat,
  MapTrifold,
  MusicNotes,
  Newspaper,
  PaintBrush,
  ShieldCheck,
  SquaresFour,
  UsersThree,
  Wallet,
  Wrench,
  type Icon,
} from 'phosphor-react-native';

import { useColors } from '@/theme';

// Icon names come from public.categories.icon.
const ICONS: Record<string, Icon> = {
  'check-square': CheckSquare,
  wrench: Wrench,
  'chat-circle': ChatCircle,
  'users-three': UsersThree,
  'music-notes': MusicNotes,
  'film-strip': FilmStrip,
  camera: Camera,
  'shield-check': ShieldCheck,
  'paint-brush': PaintBrush,
  'book-open': BookOpen,
  newspaper: Newspaper,
  'map-trifold': MapTrifold,
  heartbeat: Heartbeat,
  wallet: Wallet,
  'graduation-cap': GraduationCap,
  'cloud-sun': CloudSun,
  'folder-open': FolderOpen,
  code: Code,
  'game-controller': GameController,
};

export function CategoryIcon({ name, size = 20, color }: { name: string | undefined; size?: number; color?: string }) {
  const c = useColors();
  const Glyph = (name && ICONS[name]) || SquaresFour;
  return <Glyph size={size} color={color ?? c.text} weight="light" />;
}
